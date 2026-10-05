import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as git from '../electron/main/git';

const run = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

async function repository() {
  const root = await mkdtemp(join(tmpdir(), 'bonfire-status-'));
  run(root, 'init', '-q', '-b', 'main');
  run(root, 'config', 'user.email', 'test@example.com');
  run(root, 'config', 'user.name', 'Test');
  return root;
}

test('status outside a repository says so', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bonfire-status-'));
  try {
    assert.deepEqual(await git.status(root), {
      isGit: false,
      branch: '',
      changes: [],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('status counts lines of tracked, renamed, and untracked changes', async () => {
  const root = await repository();
  try {
    await writeFile(join(root, 'kept.txt'), 'one\ntwo\nthree\n');
    await writeFile(join(root, 'moved.txt'), 'a\nb\n');
    run(root, 'add', '.');
    run(root, 'commit', '-q', '-m', 'init');

    await writeFile(join(root, 'kept.txt'), 'one\n2\nthree\nfour\n');
    run(root, 'mv', 'moved.txt', 'renamed.txt');
    // The last line counts without a newline after it.
    await writeFile(join(root, 'new.txt'), 'x\ny\nz');
    await writeFile(join(root, 'empty.txt'), '');
    await writeFile(join(root, 'image.bin'), Buffer.from([1, 0, 2]));
    for (let index = 0; index < 20; index++)
      await writeFile(join(root, `many-${index}.txt`), 'line\n'.repeat(index));

    const status = await git.status(root);
    assert.equal(status.isGit, true);
    assert.equal(status.branch, 'main');
    const byPath = new Map(
      status.changes.map((change) => [change.path, change]),
    );
    assert.deepEqual(byPath.get('kept.txt'), {
      path: 'kept.txt',
      index: ' ',
      worktree: 'M',
      additions: 2,
      deletions: 1,
    });
    assert.equal(byPath.get('renamed.txt')?.index, 'R');
    assert.equal(byPath.has('moved.txt'), false);
    assert.deepEqual(
      [byPath.get('new.txt')?.additions, byPath.get('new.txt')?.index],
      [3, '?'],
    );
    assert.equal(byPath.get('empty.txt')?.additions, 0);
    assert.equal(byPath.get('image.bin')?.additions, 0);
    for (let index = 0; index < 20; index++)
      assert.equal(byPath.get(`many-${index}.txt`)?.additions, index);
    assert.equal(status.changes.length, 25);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('status names an unborn branch and a detached head as before', async () => {
  const root = await repository();
  try {
    await writeFile(join(root, 'first.txt'), 'hello\n');
    const unborn = await git.status(root);
    assert.equal(unborn.isGit, true);
    assert.equal(unborn.branch, 'unborn');
    assert.deepEqual(
      unborn.changes.map(({ path, additions }) => [path, additions]),
      [['first.txt', 1]],
    );

    run(root, 'add', '.');
    run(root, 'commit', '-q', '-m', 'init');
    run(root, 'checkout', '-q', '--detach');
    const detached = await git.status(root);
    assert.equal(detached.branch, 'HEAD');
    assert.deepEqual(detached.changes, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('change looks up one path without a full status', async () => {
  const root = await repository();
  try {
    await writeFile(join(root, 'kept.txt'), 'one\n');
    await writeFile(join(root, '*.txt'), 'glob\n');
    run(root, 'add', '.');
    run(root, 'commit', '-q', '-m', 'init');
    await writeFile(join(root, 'kept.txt'), 'two\n');
    await writeFile(join(root, 'new.txt'), 'new\n');

    assert.deepEqual(
      [
        (await git.change(root, 'kept.txt'))?.index,
        (await git.change(root, 'kept.txt'))?.worktree,
      ],
      [' ', 'M'],
    );
    assert.equal((await git.change(root, 'new.txt'))?.index, '?');
    assert.equal(await git.change(root, 'missing.txt'), undefined);
    // A path is taken literally, never as a pattern matching other changes.
    assert.equal(await git.change(root, '*.txt'), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
