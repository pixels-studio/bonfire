import type { Change, GitHead, GitStatus } from '../../shared/contracts';
import { localMachine, resolvePlace, type Place } from './machines';

/** How long a clone may take before it is given up on. */
const CLONE_TIMEOUT_MS = 15 * 60_000;

/** Runs git in a folder, on whichever machine the folder is, with `env` added. */
export function git(at: Place, args: string[], env?: Record<string, string>) {
  const { machine, path } = resolvePlace(at);
  return machine.exec('git', args, {
    cwd: path,
    env: { GIT_TERMINAL_PROMPT: '0', ...env },
    // git is in the usual install folders, and runs after every file change.
    profile: false,
  });
}

/** Clones `url` into `path` on this computer; git makes any missing parent folders. */
export async function clone(url: string, path: string) {
  try {
    await localMachine.exec('git', ['clone', '--', url, path], {
      env: { GIT_TERMINAL_PROMPT: '0' },
      timeout: CLONE_TIMEOUT_MS,
    });
  } catch (cause) {
    const { stderr } = cause as { stderr?: string };
    // git's last line says why; the lines before it narrate progress.
    const reason = stderr?.trim().split('\n').pop();
    throw Error(reason || (cause as Error).message);
  }
}

/**
 * How many untracked files are read at once to count their lines. Over SSH each is a round
 * trip on the shared connection, whose server allows only so many sessions at a time.
 */
const LOCAL_COUNTS_AT_ONCE = 8;
const REMOTE_COUNTS_AT_ONCE = 3;

/** Changes from `git status --porcelain=v1 -z`, with no lines counted yet. */
function parseChanges(output: string) {
  const records = output.split('\0');
  const changes: Change[] = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record) continue;
    changes.push({
      path: record.slice(3),
      index: record[0],
      worktree: record[1],
      additions: 0,
      deletions: 0,
    });
    // Renames and copies are followed by their original path; skip it.
    if (/[RC]/.test(record.slice(0, 2))) index++;
  }
  return changes;
}

/**
 * Views ask for this after every file change, and over SSH each git run is a round trip, so
 * the runs that don't depend on each other go at once rather than one after another.
 */
export async function status(cwd: Place): Promise<GitStatus> {
  const [listed, branch, counts] = await Promise.all([
    git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).catch(
      (cause: unknown) => ({ cause }),
    ),
    git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).then(
      (output) => output.trim(),
      () => 'unborn',
    ),
    lineCounts(cwd),
  ]);
  if (typeof listed !== 'string') {
    // Outside a repository there is nothing to report; inside one, the failure is real.
    const inRepository = await git(cwd, ['rev-parse', '--show-toplevel']).then(
      () => true,
      () => false,
    );
    if (inRepository) throw listed.cause;
    return { isGit: false, branch: '', changes: [] };
  }
  const changes = parseChanges(listed);
  const untracked: Change[] = [];
  for (const change of changes) {
    if (change.index === '?') untracked.push(change);
    else {
      const count = counts.get(change.path);
      change.additions = count?.additions ?? 0;
      change.deletions = count?.deletions ?? 0;
    }
  }
  const atOnce = resolvePlace(cwd).machine.remote
    ? REMOTE_COUNTS_AT_ONCE
    : LOCAL_COUNTS_AT_ONCE;
  await eachAtOnce(untracked, atOnce, async (change) => {
    change.additions =
      (await untrackedLineCount(cwd, change.path))?.additions ?? 0;
  });
  return { isGit: true, branch, changes };
}

/** The change to one path, if it has one: a status of that path alone, with no lines counted. */
export async function change(cwd: Place, path: string) {
  // Literal, so a path such as `*.txt` can't match other files as a pattern would.
  const output = await git(cwd, [
    '--literal-pathspecs',
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--',
    path,
  ]);
  return parseChanges(output).find((item) => item.path === path);
}

/** Runs `task` on each item, at most `limit` at a time. */
async function eachAtOnce<Item>(
  items: Item[],
  limit: number,
  task: (item: Item) => Promise<void>,
) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await task(items[next++]);
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
}

type LineCount = { additions: number; deletions: number };

/** Added and removed lines per tracked path against HEAD (`-` stands for binary files). */
async function lineCounts(cwd: Place) {
  const counts = new Map<string, LineCount>();
  const output = await git(cwd, ['diff', 'HEAD', '--numstat', '-z']).catch(
    () => '',
  );
  const records = output.split('\0');
  for (let index = 0; index < records.length; index++) {
    const [additions, deletions, path] = records[index].split('\t');
    if (additions === undefined || deletions === undefined) continue;
    const count = {
      additions: Number(additions) || 0,
      deletions: Number(deletions) || 0,
    };
    // Renames and copies have an empty path, followed by the old and the new path.
    if (path === '') {
      counts.set(records[index + 2], count);
      index += 2;
    } else counts.set(path, count);
  }
  return counts;
}

const COUNT_LIMIT_BYTES = 2 * 1024 * 1024;

/** An untracked file counts as entirely added. */
async function untrackedLineCount(
  cwd: Place,
  path: string,
): Promise<LineCount | undefined> {
  try {
    const { machine, path: root } = resolvePlace(cwd);
    const data = await machine.readFile(
      machine.path.join(root, path),
      COUNT_LIMIT_BYTES,
    );
    if (data.includes(0)) return undefined;
    const text = data.toString('utf8');
    if (!text) return undefined;
    const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    return { additions: lines, deletions: 0 };
  } catch {
    return undefined;
  }
}

export function diff(cwd: Place, path: string) {
  return git(cwd, ['diff', 'HEAD', '--', path]).catch(() =>
    git(cwd, ['diff', '--', path]),
  );
}

/** The diff of an untracked file against nothing, so it reads like any other added file. */
export async function diffUntracked(cwd: Place, path: string) {
  try {
    return await git(cwd, ['diff', '--no-index', '--', '/dev/null', path]);
  } catch (cause) {
    // `--no-index` exits with 1 when the files differ, which is the usual case here.
    const { stdout } = cause as { stdout?: string };
    if (stdout) return stdout;
    throw cause;
  }
}

/**
 * Throws away the uncommitted changes to one path, or to the whole tree without one:
 * edits are restored from HEAD, and files that are new to the repository are deleted.
 */
export async function discard(cwd: Place, path?: string) {
  const hasHead = await git(cwd, ['rev-parse', '--verify', 'HEAD']).then(
    () => true,
    () => false,
  );
  if (path === undefined) {
    if (hasHead) await git(cwd, ['reset', '--hard', 'HEAD']);
    else
      await git(cwd, ['rm', '-r', '-f', '--cached', '--ignore-unmatch', '.']);
    await git(cwd, ['clean', '-f', '-d']);
    return;
  }
  const item = await change(cwd, path);
  if (!item) return;
  if (item.index === '?') {
    await git(cwd, ['--literal-pathspecs', 'clean', '-f', '--', path]);
  } else if (!hasHead || 'ACR'.includes(item.index)) {
    // Not in HEAD, so there is nothing to restore it to.
    await git(cwd, ['--literal-pathspecs', 'rm', '-f', '--', path]);
  } else {
    await git(cwd, [
      '--literal-pathspecs',
      'restore',
      '--source=HEAD',
      '--staged',
      '--worktree',
      '--',
      path,
    ]);
  }
}

/** Brings remote-tracking branches up to date, so a new branch starts from the latest commit. */
export async function fetch(cwd: Place) {
  await git(cwd, ['fetch', '--quiet', 'origin']);
}

/** git's own explanation of a failure, without the command line it ran. */
export function gitError(cause: unknown) {
  const { stderr = '' } = cause as { stderr?: string };
  const lines = stderr
    .split('\n')
    .map((line) => line.replace(/^(error|fatal|hint): /, '').trim())
    .filter((line) => line && !line.startsWith('Aborting'));
  return lines.length ? Error(lines.join(' ')) : (cause as Error);
}

/** What the folder has checked out; a new repository's branch has a name before any commit. */
export async function head(cwd: Place): Promise<GitHead> {
  try {
    const branch = await git(cwd, [
      'symbolic-ref',
      '--quiet',
      '--short',
      'HEAD',
    ]);
    return { isGit: true, branch: branch.trim() };
  } catch (cause) {
    // Exits with 1 when HEAD is detached, and 128 outside a repository.
    return { isGit: (cause as { code?: unknown }).code === 1 };
  }
}

/** The checked-out branch, or undefined when HEAD is detached or this isn't a repository. */
export async function currentBranch(cwd: Place) {
  try {
    const branch = (
      await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
    ).trim();
    return branch === 'HEAD' ? undefined : branch;
  } catch {
    return undefined;
  }
}

/** The remote's default branch, such as `main`, when the clone knows it. */
export async function defaultBranch(cwd: Place) {
  try {
    const ref = await git(cwd, ['rev-parse', '--abbrev-ref', 'origin/HEAD']);
    return ref.trim().replace(/^origin\//, '');
  } catch {
    return undefined;
  }
}

/**
 * The branches work can start from: local ones and `origin`'s, each name once, the most
 * recently committed to first.
 */
export async function branches(cwd: Place) {
  const output = await git(cwd, [
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname)',
    'refs/heads',
    'refs/remotes/origin',
  ]);
  const names = new Set<string>();
  for (const ref of output.split('\n')) {
    const name = ref
      .trim()
      .replace(/^refs\/heads\//, '')
      .replace(/^refs\/remotes\/origin\//, '');
    if (name && name !== 'HEAD' && !name.startsWith('refs/')) names.add(name);
  }
  return [...names];
}

/** Subjects of the commits on HEAD that `base` doesn't have, newest first. */
export async function commitsAhead(cwd: Place, base: string) {
  const output = await git(cwd, ['log', '--format=%s', `${base}..HEAD`]);
  return output.split('\n').filter(Boolean);
}

/** What `HEAD` and the working tree change beyond `base`: committed work and uncommitted work. */
export async function changesBeyond(cwd: Place, base: string) {
  const refs = [`origin/${base}`, base];
  let committed = '';
  for (const ref of refs)
    try {
      committed = await git(cwd, ['diff', `${ref}...HEAD`]);
      break;
    } catch {
      // The ref isn't known here; try the next.
    }
  const uncommitted = await git(cwd, ['diff', 'HEAD']).catch(() => '');
  return [committed, uncommitted].filter(Boolean).join('\n');
}

/** The first commit message's body beyond its subject, for a pull request description. */
export async function lastCommitBody(cwd: Place) {
  return (await git(cwd, ['log', '-1', '--format=%b'])).trim();
}

/** Stages and commits everything, new files included. */
export async function commitAll(cwd: Place, message: string) {
  await git(cwd, ['add', '--all']);
  await git(cwd, ['commit', '--message', message]);
}

/** How many commits the checked-out branch has that its upstream lacks; all of them with no upstream. */
export async function unpushedCount(cwd: Place) {
  const count = (args: string[]) =>
    git(cwd, ['rev-list', '--count', ...args]).then((out) =>
      Number(out.trim()),
    );
  return count(['@{upstream}..HEAD']).catch(() =>
    count(['HEAD', '--not', '--remotes']).catch(() => 0),
  );
}

/** Pushes the checked-out branch to a branch of the same name on origin and tracks it. */
export async function pushBranch(cwd: Place) {
  await git(cwd, ['push', '--set-upstream', 'origin', 'HEAD']);
}

/** Runs git, failing with git's own explanation. */
function gitOrExplain(at: Place, args: string[], env?: Record<string, string>) {
  return git(at, args, env).catch((cause: unknown) => {
    throw gitError(cause);
  });
}

/** Whether the repository has the ref, such as `refs/heads/main`. */
export function hasRef(cwd: Place, ref: string) {
  return git(cwd, ['rev-parse', '--verify', '--quiet', ref]).then(
    () => true,
    () => false,
  );
}

/**
 * Adds a worktree at `path`: on a new `branch` from `base` when given one, else on the
 * existing `branch`. The new branch doesn't track `base`, so a push never lands on it.
 */
export async function addWorktree(
  repository: Place,
  path: string,
  branch: string,
  base?: string,
) {
  await gitOrExplain(
    repository,
    base
      ? ['worktree', 'add', '--no-track', '-b', branch, '--', path, base]
      : ['worktree', 'add', '--', path, branch],
  );
}

/** Removes the worktree at `path` and anything in it; one already gone is forgotten. */
export async function removeWorktree(repository: Place, path: string) {
  await git(repository, ['worktree', 'remove', '--force', '--', path]).catch(
    () => git(repository, ['worktree', 'prune']),
  );
}

export async function deleteBranch(repository: Place, branch: string) {
  await gitOrExplain(repository, ['branch', '-D', '--', branch]);
}

export async function deleteRef(repository: Place, ref: string) {
  await git(repository, ['update-ref', '-d', ref]);
}

/** Who a snapshot is by; it never leaves the repository, so the user's name isn't needed. */
const SNAPSHOT_AUTHOR = {
  GIT_AUTHOR_NAME: 'Bonfire',
  GIT_AUTHOR_EMAIL: 'bonfire@localhost',
  GIT_COMMITTER_NAME: 'Bonfire',
  GIT_COMMITTER_EMAIL: 'bonfire@localhost',
};

/**
 * Saves the working tree, uncommitted and untracked files included, as a commit on top of
 * HEAD under `ref`. A separate index keeps the real one as it was; ignored files stay out.
 */
export async function saveWorkingTree(
  cwd: Place,
  ref: string,
  message: string,
) {
  const index = (
    await git(cwd, ['rev-parse', '--git-path', 'bonfire-snapshot-index'])
  ).trim();
  const env = { GIT_INDEX_FILE: index };
  await gitOrExplain(cwd, ['read-tree', 'HEAD'], env);
  await gitOrExplain(cwd, ['add', '--all'], env);
  const tree = (await gitOrExplain(cwd, ['write-tree'], env)).trim();
  const commit = (
    await gitOrExplain(
      cwd,
      ['commit-tree', tree, '-p', 'HEAD', '-m', message],
      SNAPSHOT_AUTHOR,
    )
  ).trim();
  await gitOrExplain(cwd, ['update-ref', ref, commit]);
}

/**
 * Puts the working tree back as `saveWorkingTree` saved it under `ref`, on a checkout of
 * the commit it was saved on. Everything comes back uncommitted, as it was, but unstaged.
 */
export async function restoreWorkingTree(cwd: Place, ref: string) {
  const deleted = (
    await git(cwd, [
      'diff',
      '--name-only',
      '--no-renames',
      '--diff-filter=D',
      '-z',
      'HEAD',
      ref,
    ])
  )
    .split('\0')
    .filter(Boolean);
  // A snapshot with no files at all has nothing to check out, which git would refuse.
  if ((await git(cwd, ['ls-tree', '--name-only', ref])).trim())
    await gitOrExplain(cwd, ['checkout', ref, '--', '.']);
  if (deleted.length)
    await gitOrExplain(cwd, [
      '--literal-pathspecs',
      'rm',
      '--quiet',
      '--',
      ...deleted,
    ]);
  await gitOrExplain(cwd, ['reset', '--quiet']);
}
