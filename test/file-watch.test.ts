import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { FileChangeEvent } from '../shared/contracts';
import { Filesystem } from '../electron/main/filesystem';
import { sleep } from './helpers';

/** Long enough for the OS to report a change and the watcher to let a burst settle. */
const SETTLE_MS = 600;

async function repository() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bonfire-watch-')));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  await writeFile(join(root, 'README.md'), 'hello\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'First');
  return { root, git };
}

async function watching(root: string) {
  const files = new Filesystem();
  const kinds: FileChangeEvent['kind'][] = [];
  const live = files.watch('project', root, (event) => kinds.push(event.kind));
  // The Git folder is found with a Git run, so its watcher starts a moment later.
  await sleep(SETTLE_MS);
  return {
    live,
    /** The kinds reported since last asked, each once. */
    async seen() {
      await sleep(SETTLE_MS);
      const seen = new Set(kinds.splice(0));
      return seen;
    },
    close: () => files.close(),
  };
}

test('changes anywhere in the folder are reported, however deep', async () => {
  const { root } = await repository();
  const watch = await watching(root);
  try {
    assert.equal(watch.live, true);
    const deep = join(root, 'a', 'b', 'c', 'd', 'e');
    await mkdir(deep, { recursive: true });
    await watch.seen();
    await writeFile(join(deep, 'file.ts'), 'changed');
    assert.ok((await watch.seen()).has('files'));
  } finally {
    await watch.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('changes in hidden folders, such as node_modules, are not', async () => {
  const { root } = await repository();
  await mkdir(join(root, 'node_modules', 'package'), { recursive: true });
  const watch = await watching(root);
  try {
    await writeFile(join(root, 'node_modules', 'package', 'index.js'), 'x');
    assert.equal((await watch.seen()).size, 0);
  } finally {
    await watch.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('switching branches, staging, and committing are each reported', async () => {
  const { root, git } = await repository();
  const watch = await watching(root);
  try {
    git('switch', '--quiet', '-c', 'feature');
    assert.ok((await watch.seen()).has('head'));
    await writeFile(join(root, 'README.md'), 'changed\n');
    await watch.seen();
    git('add', 'README.md');
    assert.ok((await watch.seen()).has('files'));
    git('commit', '--quiet', '-m', 'Second');
    assert.ok((await watch.seen()).has('refs'));
  } finally {
    await watch.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a worktree's switches are reported, not those of the main checkout", async () => {
  const { root, git } = await repository();
  const worktree = join(root, '..', `${root.split('/').pop()}-worktree`);
  git('worktree', 'add', '--quiet', '-b', 'side', worktree);
  const watch = await watching(worktree);
  try {
    git('switch', '--quiet', '-c', 'elsewhere');
    assert.ok(!(await watch.seen()).has('head'));
    execFileSync('git', ['switch', '--quiet', '-c', 'other'], {
      cwd: worktree,
      stdio: 'pipe',
    });
    assert.ok((await watch.seen()).has('head'));
  } finally {
    await watch.close();
    await rm(worktree, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test('a burst of changes is reported once', async () => {
  const { root } = await repository();
  const files = new Filesystem();
  let reports = 0;
  files.watch('project', root, () => reports++);
  await sleep(SETTLE_MS);
  try {
    for (let index = 0; index < 50; index++)
      await writeFile(join(root, `file-${index}.txt`), 'x');
    await sleep(SETTLE_MS);
    assert.ok(reports >= 1 && reports <= 2, `reported ${reports} times`);
  } finally {
    await files.close();
    await rm(root, { recursive: true, force: true });
  }
});
