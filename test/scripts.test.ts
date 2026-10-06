import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { localMachine } from '../electron/main/machines';
import { detectScripts, pnpmWorkspaces } from '../electron/main/scripts';

/** A temporary project folder with the given files, removed afterwards. */
async function withProject(
  files: Record<string, string | object>,
  check: (root: string) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), 'bonfire-scripts-'));
  try {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(
        join(root, path),
        typeof content === 'string' ? content : JSON.stringify(content),
      );
    }
    await check(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('a single app runs its dev script with its package manager', () =>
  withProject(
    {
      'package.json': { scripts: { build: 'vite build', dev: 'vite' } },
      'yarn.lock': '',
    },
    async (root) => {
      assert.deepEqual(await detectScripts(localMachine, root), [
        { name: 'Dev server', command: 'yarn dev' },
      ]);
    },
  ));

test('npm projects use npm run, and fall back to start', () =>
  withProject(
    { 'package.json': { scripts: { start: 'node server.js' } } },
    async (root) => {
      assert.deepEqual(await detectScripts(localMachine, root), [
        { name: 'Start', command: 'npm run start' },
      ]);
    },
  ));

test('a pnpm monorepo offers the root script and each app, apps first', () =>
  withProject(
    {
      'package.json': {
        packageManager: 'pnpm@9.0.0',
        scripts: { dev: 'turbo dev' },
      },
      'pnpm-workspace.yaml': 'packages:\n  - \'packages/*\'\n  - "apps/*"\n',
      'packages/ui/package.json': {
        name: '@acme/ui',
        scripts: { dev: 'tsup --watch' },
      },
      'packages/config/package.json': { name: '@acme/config' },
      'apps/web/package.json': { name: '@acme/web', scripts: { dev: 'next' } },
      'apps/mobile/package.json': {
        name: '@acme/mobile',
        scripts: { start: 'expo start' },
      },
    },
    async (root) => {
      assert.deepEqual(await detectScripts(localMachine, root), [
        { name: 'All apps', command: 'pnpm dev' },
        { name: 'mobile', command: 'pnpm --filter @acme/mobile start' },
        { name: 'web', command: 'pnpm --filter @acme/web dev' },
        { name: 'ui', command: 'pnpm --filter @acme/ui dev' },
      ]);
    },
  ));

test('npm workspaces run through --workspace', () =>
  withProject(
    {
      'package.json': { workspaces: ['site'] },
      'site/package.json': { name: 'site', scripts: { dev: 'astro dev' } },
    },
    async (root) => {
      assert.deepEqual(await detectScripts(localMachine, root), [
        { name: 'site', command: 'npm run dev --workspace site' },
      ]);
    },
  ));

test('bonfire.json and other stacks are detected', () =>
  withProject(
    {
      'bonfire.json': { scripts: { run: 'make serve' } },
      'Cargo.toml': '[package]',
      Makefile: 'VAR := 1\nserve:\n\tcargo run\n',
    },
    async (root) => {
      assert.deepEqual(await detectScripts(localMachine, root), [
        { name: 'Run', command: 'make serve' },
        { name: 'Cargo run', command: 'cargo run' },
      ]);
    },
  ));

test('a folder with nothing to run detects nothing', () =>
  withProject({ 'README.md': '# hi' }, async (root) => {
    assert.deepEqual(await detectScripts(localMachine, root), []);
  }));

test('pnpm workspace globs are read from the packages list', () => {
  assert.deepEqual(
    pnpmWorkspaces(
      "packages:\n  - apps/*\n  - 'tools/cli' # the CLI\n  - '!**/test'\ncatalog:\n  react: ^19\n",
    ),
    ['apps/*', 'tools/cli', '!**/test'],
  );
});
