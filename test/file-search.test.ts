import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Filesystem, rankFiles } from '../electron/main/filesystem';

test('rankFiles puts name matches before path matches', () => {
  const paths = ['src/panel/readme.md', 'src/panel.ts', 'panel.ts', 'a/b.ts'];
  assert.deepEqual(rankFiles(paths, 'panel', 10), [
    'panel.ts',
    'src/panel.ts',
    'src/panel/readme.md',
  ]);
});

test('rankFiles needs every word and ignores case', () => {
  const paths = ['src/Inspector.svelte', 'src/other.svelte'];
  assert.deepEqual(rankFiles(paths, 'SRC insp', 10), ['src/Inspector.svelte']);
  assert.deepEqual(rankFiles(paths, '  ', 10), []);
});

test('search skips hidden folders in a plain directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bonfire-search-'));
  try {
    await mkdir(join(root, 'src'));
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'src', 'main.ts'), '');
    await writeFile(join(root, 'node_modules', 'main.js'), '');
    assert.deepEqual(await new Filesystem().search(root, 'main'), [
      'src/main.ts',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
