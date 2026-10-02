import { execFile } from 'node:child_process';
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
    });
    // Renames and copies are followed by their original path; skip it.
    if (/[RC]/.test(record.slice(0, 2))) index++;
  }
  return { isGit: true, branch, changes };
}

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

export async function checkout(cwd: string, branch: string) {
  await git(cwd, ['checkout', branch]);
}
