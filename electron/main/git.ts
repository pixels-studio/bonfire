import type {
  Branch,
  Change,
  GitHead,
  GitStatus,
} from '../../shared/contracts';
import { resolvePlace, type Place } from './machines';

/** Runs git in a folder, on whichever machine the folder is. */
export function git(at: Place, args: string[]) {
  const { machine, path } = resolvePlace(at);
  return machine.exec('git', args, {
    cwd: path,
    env: { GIT_TERMINAL_PROMPT: '0' },
  });
}

export async function status(cwd: Place): Promise<GitStatus> {
  try {
    await git(cwd, ['rev-parse', '--show-toplevel']);
  } catch {
    return { isGit: false, branch: '', changes: [] };
  }
  const branch = (
    await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'unborn')
  ).trim();
  const records = (
    await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  ).split('\0');

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
  const counts = await lineCounts(cwd);
  for (const change of changes) {
    const count =
      change.index === '?'
        ? await untrackedLineCount(cwd, change.path)
        : counts.get(change.path);
    change.additions = count?.additions ?? 0;
    change.deletions = count?.deletions ?? 0;
  }
  return { isGit: true, branch, changes };
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

/** Local branches, then remote-tracking ones such as `origin/main`. */
export async function branches(cwd: Place) {
  try {
    const output = await git(cwd, [
      'for-each-ref',
      '--format=%(refname)\t%(refname:short)',
      'refs/heads',
      'refs/remotes',
    ]);
    return output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t'))
      .filter(([fullName]) => !fullName.endsWith('/HEAD'))
      .map(([, shortName]) => shortName);
  } catch {
    return [];
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

/** Brings remote-tracking branches up to date, so a new branch starts from the latest commit. */
export async function fetch(cwd: Place) {
  await git(cwd, ['fetch', '--quiet', 'origin']);
}

/** git's own explanation of a failure, without the command line it ran. */
export function gitError(cause: unknown) {
  const { stderr = '' } = cause as { stderr?: string };
  // git lists the files a switch would overwrite one per line, which reads poorly as a sentence.
  const overwritten = /would be overwritten by checkout:\n((?:\t.*\n)+)/.exec(
    stderr,
  );
  if (overwritten) {
    const files = overwritten[1].trim().split(/\n\t/);
    return Error(
      `Switching would overwrite uncommitted changes to ${files.join(', ')}. Commit or stash them first.`,
    );
  }
  const lines = stderr
    .split('\n')
    .map((line) => line.replace(/^(error|fatal|hint): /, '').trim())
    .filter((line) => line && !line.startsWith('Aborting'));
  return lines.length ? Error(lines.join(' ')) : (cause as Error);
}

/** Local branches, most recently committed first. */
export async function localBranches(cwd: Place): Promise<Branch[]> {
  const output = await git(cwd, [
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname:short)%00%(committerdate:unix)%00%(contents:subject)',
    'refs/heads',
  ]);
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, date, subject] = line.split('\0');
      return { name, subject: subject ?? '', committedAt: Number(date) * 1000 };
    });
}

/** Switches to `branch`, bringing uncommitted changes along unless they would conflict. */
export async function switchBranch(cwd: Place, branch: string) {
  await git(cwd, ['switch', '--no-guess', '--', branch]).catch((cause) => {
    throw gitError(cause);
  });
}

/**
 * Creates `name` from `base` and switches to it. The branch doesn't track `base`, so a
 * later push or pull never lands on the base branch by mistake.
 */
export async function createBranch(cwd: Place, name: string, base: string) {
  try {
    await git(cwd, ['check-ref-format', '--branch', name]);
  } catch {
    throw Error(`“${name}” isn’t a valid branch name.`);
  }
  await git(cwd, ['switch', '--no-track', '--create', name, '--', base]).catch(
    (cause) => {
      throw gitError(cause);
    },
  );
}

/** Fast-forwards the checked-out branch to its upstream, refusing to merge. */
export async function pull(cwd: Place) {
  await git(cwd, ['pull', '--ff-only', '--quiet']).catch((cause) => {
    throw gitError(cause);
  });
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

/** Subjects of the commits on HEAD that `base` doesn't have, newest first. */
export async function commitsAhead(cwd: Place, base: string) {
  const output = await git(cwd, ['log', '--format=%s', `${base}..HEAD`]);
  return output.split('\n').filter(Boolean);
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

/** Pushes the checked-out branch to a branch of the same name on origin and tracks it. */
export async function pushBranch(cwd: Place) {
  await git(cwd, ['push', '--set-upstream', 'origin', 'HEAD']);
}
