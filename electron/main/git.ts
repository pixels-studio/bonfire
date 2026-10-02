import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitStatus } from '../../shared/contracts';
const exec = promisify(execFile);
export async function git(cwd: string, args: string[]) {
  return (
    await exec('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
  ).stdout;
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
  const raw = await git(cwd, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ]);
  const records = raw.split('\0');
  const changes = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!r) continue;
    changes.push({ path: r.slice(3), index: r[0], worktree: r[1] });
    if (/[RC]/.test(r.slice(0, 2))) i++;
  }
  return { isGit: true, branch, changes };
}
export async function branches(cwd: string) {
  try {
    return (
      await git(cwd, [
        'for-each-ref',
        '--format=%(refname:short)',
        'refs/heads',
        'refs/remotes',
      ])
    )
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}
export async function diff(cwd: string, path: string) {
  return await git(cwd, ['diff', 'HEAD', '--', path]).catch(() =>
    git(cwd, ['diff', '--', path]),
  );
}
export async function checkout(cwd: string, branch: string) {
  await git(cwd, ['checkout', branch]);
}
