import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Change, GitStatus } from '../../shared/contracts';

const execFileAsync = promisify(execFile);

export async function git(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 30_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return stdout;
}

export async function status(cwd: string): Promise<GitStatus> {
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
async function lineCounts(cwd: string) {
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
  cwd: string,
  path: string,
): Promise<LineCount | undefined> {
  try {
    const file = join(cwd, path);
    if ((await stat(file)).size > COUNT_LIMIT_BYTES) return undefined;
    const data = await readFile(file);
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
export async function branches(cwd: string) {
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

export function diff(cwd: string, path: string) {
  return git(cwd, ['diff', 'HEAD', '--', path]).catch(() =>
    git(cwd, ['diff', '--', path]),
  );
}

/** The diff of an untracked file against nothing, so it reads like any other added file. */
export async function diffUntracked(cwd: string, path: string) {
  try {
    return await git(cwd, ['diff', '--no-index', '--', '/dev/null', path]);
  } catch (cause) {
    // `--no-index` exits with 1 when the files differ, which is the usual case here.
    const { stdout } = cause as { stdout?: string };
    if (stdout) return stdout;
    throw cause;
  }
}

/** Brings remote-tracking branches up to date, so new workspaces start from the latest commit. */
export async function fetch(cwd: string) {
  await git(cwd, ['fetch', '--quiet', 'origin']);
}

/**
 * Creates a worktree at `path` on a new `branch` started from `base`. The branch doesn't
 * track `base`, so a later push or pull never lands on the base branch by mistake.
 */
export async function addWorktree(
  repository: string,
  path: string,
  branch: string,
  base: string,
) {
  await git(repository, [
    'worktree',
    'add',
    '--no-track',
    '-b',
    branch,
    path,
    base,
  ]);
}

/** Checks an existing branch out into a new worktree at `path`. */
export async function checkoutWorktree(
  repository: string,
  path: string,
  branch: string,
) {
  await git(repository, ['worktree', 'add', path, branch]);
}

/** Removes a worktree, refusing when it has uncommitted changes so no work is lost. */
export async function removeWorktree(repository: string, path: string) {
  await git(repository, ['worktree', 'remove', path]);
}

/** Forgets worktrees whose folders are gone. */
export async function pruneWorktrees(repository: string) {
  await git(repository, ['worktree', 'prune']);
}

export async function branchExists(repository: string, branch: string) {
  try {
    await git(repository, [
      'show-ref',
      '--verify',
      '--quiet',
      `refs/heads/${branch}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function deleteBranch(repository: string, branch: string) {
  await git(repository, ['branch', '-D', branch]);
}

export async function renameBranch(cwd: string, from: string, to: string) {
  await git(cwd, ['branch', '-m', from, to]);
}

/** Whether the branch has been pushed, i.e. has an upstream. */
export async function hasUpstream(cwd: string, branch: string) {
  try {
    await git(cwd, ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]);
    return true;
  } catch {
    return false;
  }
}

/** Untracked files in `cwd` matched by the gitignore-style `patterns` and ignored by the repository. */
export async function ignoredFilesMatching(cwd: string, patternsFile: string) {
  const matching = (
    await git(cwd, [
      'ls-files',
      '--others',
      '--ignored',
      `--exclude-from=${patternsFile}`,
      '-z',
    ])
  )
    .split('\0')
    .filter(Boolean);
  if (!matching.length) return [];
  const ignored = await new Promise<string>((resolve) => {
    const child = execFile(
      'git',
      ['check-ignore', '-z', '--stdin'],
      { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30_000 },
      // Exits 1 when nothing is ignored.
      (_error, stdout) => resolve(stdout ?? ''),
    );
    child.stdin?.end(matching.join('\0') + '\0');
  });
  return ignored.split('\0').filter(Boolean);
}

/** The checked-out branch, or undefined when HEAD is detached or this isn't a repository. */
export async function currentBranch(cwd: string) {
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
export async function defaultBranch(cwd: string) {
  try {
    const ref = await git(cwd, ['rev-parse', '--abbrev-ref', 'origin/HEAD']);
    return ref.trim().replace(/^origin\//, '');
  } catch {
    return undefined;
  }
}

/** Subjects of the commits on HEAD that `base` doesn't have, newest first. */
export async function commitsAhead(cwd: string, base: string) {
  const output = await git(cwd, ['log', '--format=%s', `${base}..HEAD`]);
  return output.split('\n').filter(Boolean);
}

/** The first commit message's body beyond its subject, for a pull request description. */
export async function lastCommitBody(cwd: string) {
  return (await git(cwd, ['log', '-1', '--format=%b'])).trim();
}

/** Stages and commits everything, new files included. */
export async function commitAll(cwd: string, message: string) {
  await git(cwd, ['add', '--all']);
  await git(cwd, ['commit', '--message', message]);
}

/** Pushes the checked-out branch to a branch of the same name on origin and tracks it. */
export async function pushBranch(cwd: string) {
  await git(cwd, ['push', '--set-upstream', 'origin', 'HEAD']);
}
