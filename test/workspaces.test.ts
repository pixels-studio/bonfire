import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { stateSchema, type Project } from '../shared/contracts';
import {
  DEFAULT_PREFERENCES,
  WORKSPACE_NAMES,
  pickWorkspaceName,
  resolveProjectSettings,
  slugify,
  uniqueName,
} from '../shared/domain';
import { PendingAttachments } from '../electron/main/attachments';
import * as git from '../electron/main/git';
import { settleWorkspaces } from '../electron/main/persistence';
import { copyIgnoredFiles, freePort } from '../electron/main/worktrees';

const uuid = () => crypto.randomUUID();

test('workspace names skip taken ones, then get numbered', () => {
  const taken = new Set(WORKSPACE_NAMES.filter((name) => name !== 'europa'));
  assert.equal(
    pickWorkspaceName((name) => taken.has(name)),
    'europa',
  );
  taken.add('europa');
  assert.match(
    pickWorkspaceName((name) => taken.has(name)),
    /^[a-z]+-2$/,
  );
});

test('titles become branch-safe slugs', () => {
  assert.equal(slugify('Fix dropdown height!'), 'fix-dropdown-height');
  assert.equal(slugify('  Café — über naïve  '), 'cafe-uber-naive');
  assert.equal(slugify('***'), '');
  assert.ok(slugify('a'.repeat(100)).length <= 40);
  assert.equal(
    uniqueName('bonfire/fix', (name) =>
      ['bonfire/fix', 'bonfire/fix-2'].includes(name),
    ),
    'bonfire/fix-3',
  );
});

test('project settings override the app-wide ones only where set', () => {
  const project = {
    settings: { branchPrefix: 'team/', deleteBranchOnArchive: true },
  } as Project;
  const resolved = resolveProjectSettings(project, {
    ...DEFAULT_PREFERENCES,
    archiveOnMerge: true,
  });
  assert.equal(resolved.branchPrefix, 'team/');
  assert.equal(resolved.deleteBranchOnArchive, true);
  assert.equal(resolved.archiveOnMerge, true);
  assert.equal(resolved.setupScript, '');
  assert.equal(
    resolveProjectSettings({ settings: {} } as Project, DEFAULT_PREFERENCES)
      .branchPrefix,
    'bonfire/',
  );
});

test('workspaces get the first free block of ports', () => {
  const session = (port: number, archived = false) =>
    ({ port, archived }) as never;
  assert.equal(freePort([]), 41_000);
  assert.equal(freePort([session(41_000), session(41_010, true)]), 41_010);
});

test('state from before workspaces gets one default workspace per project', () => {
  const projectId = uuid();
  const [older, newer] = [uuid(), uuid()];
  const [kept, moved, orphan] = [uuid(), uuid(), uuid()];
  const pane = (id: string, sessionId?: string, messages = 0) => ({
    id,
    sessionId,
    type: 'claude',
    title: 'Pane',
    messages: Array.from({ length: messages }, (_, index) => ({
      id: String(index),
      role: 'user',
      kind: 'text',
      text: 'hi',
    })),
  });
  const state = stateSchema.parse({
    version: 1,
    projects: [
      {
        id: projectId,
        name: 'helm',
        path: '/repo',
        createdAt: 0,
        lastOpenedAt: 0,
      },
    ],
    sessions: [older, newer].map((id, index) => ({
      id,
      projectId,
      title: 'Workspace',
      worktreePath: '/repo',
      createdAt: 0,
      lastOpenedAt: index,
    })),
    panes: [pane(kept, newer, 1), pane(moved, older, 1), pane(orphan)],
    layout: { paneIds: [orphan, kept, moved] },
    lastProjectId: projectId,
    settings: {},
  });
  settleWorkspaces(state);
  assert.deepEqual(
    state.sessions.map(({ id }) => id),
    [newer],
  );
  assert.ok(state.panes.every((item) => item.sessionId === newer));
  assert.deepEqual(state.layout.paneIds, [kept, moved]);
  assert.equal(state.currentSessionId, newer);
  assert.deepEqual(state.projects[0].settings, {});
});

test('a draft hands its attachments to the pane made from it', () => {
  const attachments = new PendingAttachments();
  const { id } = attachments.addText('draft', 'long text');
  assert.throws(() => attachments.get('pane', [id]));
  attachments.transfer('draft', 'pane');
  assert.equal(attachments.get('pane', [id])[0].kind, 'text');
  attachments.discard('pane');
  assert.throws(() => attachments.get('pane', [id]));
});

test('worktrees start on a new untracked branch and keep uncommitted work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bonfire-worktrees-'));
  const run = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  try {
    const repository = join(root, 'repo');
    execFileSync('git', ['init', '-q', '-b', 'main', repository]);
    run(repository, 'config', 'user.email', 'test@example.com');
    run(repository, 'config', 'user.name', 'Test');
    await writeFile(join(repository, '.gitignore'), '.env*\nnode_modules/\n');
    await writeFile(join(repository, 'readme.md'), 'hi\n');
    run(repository, 'add', '.');
    run(repository, 'commit', '-q', '-m', 'init');
    await writeFile(join(repository, '.env.local'), 'SECRET=1\n');
    await writeFile(join(repository, 'notes.txt'), 'untracked, not ignored\n');

    const path = join(root, 'workspaces', 'helm', 'europa');
    await git.addWorktree(repository, path, 'bonfire/europa', 'main');
    assert.equal(await git.currentBranch(path), 'bonfire/europa');
    assert.equal(await git.hasUpstream(path, 'bonfire/europa'), false);

    const project = {
      id: uuid(),
      name: 'helm',
      path: repository,
      createdAt: 0,
      lastOpenedAt: 0,
      settings: {},
    };
    assert.equal(await copyIgnoredFiles(project, path, '.env*'), 1);
    assert.equal(
      await readFile(join(path, '.env.local'), 'utf8'),
      'SECRET=1\n',
    );
    assert.equal(existsSync(join(path, 'notes.txt')), false);

    await git.renameBranch(path, 'bonfire/europa', 'bonfire/fix-dropdown');
    assert.equal(await git.currentBranch(path), 'bonfire/fix-dropdown');

    await writeFile(join(path, 'readme.md'), 'changed\n');
    await assert.rejects(() => git.removeWorktree(repository, path));
    assert.ok(existsSync(path));

    run(path, 'checkout', '-q', '--', 'readme.md');
    await rm(join(path, '.env.local'));
    await git.removeWorktree(repository, path);
    assert.equal(existsSync(path), false);
    assert.ok(await git.branchExists(repository, 'bonfire/fix-dropdown'));
    await git.checkoutWorktree(repository, path, 'bonfire/fix-dropdown');
    assert.equal(await git.currentBranch(path), 'bonfire/fix-dropdown');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
