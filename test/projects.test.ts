import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { stateSchema } from '../shared/contracts';
import * as git from '../electron/main/git';
import { migrate, settleProjects } from '../electron/main/persistence';

const uuid = () => crypto.randomUUID();

test('panes move from workspaces to their project', () => {
  const [projectId, otherProjectId] = [uuid(), uuid()];
  const [folder, worktree] = [uuid(), uuid()];
  const [started, empty, working, idle, orphan] = [
    uuid(),
    uuid(),
    uuid(),
    uuid(),
    uuid(),
  ];
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
  const project = (id: string, path: string) => ({
    id,
    name: 'helm',
    path,
    createdAt: 0,
    lastOpenedAt: 0,
    settings: { setupScript: 'npm ci' },
  });
  const state = stateSchema.parse(
    migrate({
      version: 1,
      projects: [project(projectId, '/repo'), project(otherProjectId, '/b')],
      sessions: [
        { id: folder, projectId, title: '', worktreePath: '/repo' },
        {
          id: worktree,
          projectId,
          title: '',
          worktreePath: '/worktrees/helm/europa',
        },
      ],
      panes: [
        pane(started, folder, 1),
        pane(empty, folder),
        pane(working, worktree, 1),
        pane(idle, worktree),
        pane(orphan),
      ],
      layout: { paneIds: [orphan, started, empty, working, idle] },
      lastProjectId: otherProjectId,
      currentSessionId: worktree,
      settings: {},
    } as never),
  );
  settleProjects(state);
  // Panes on the project folder stay open; those that worked in a worktree are archived.
  assert.deepEqual(
    state.panes.map(({ id, projectId, archived }) => [id, projectId, archived]),
    [
      [started, projectId, false],
      [empty, projectId, false],
      [working, projectId, true],
    ],
  );
  assert.deepEqual(state.layout.paneIds, [started, empty, working]);
  assert.equal(state.lastProjectId, projectId);
  assert.equal('sessions' in state, false);
  assert.equal('settings' in state.projects[0], false);
});

test('a missing project on screen falls back to the first', () => {
  const projectId = uuid();
  const state = stateSchema.parse({
    version: 1,
    projects: [
      { id: projectId, name: 'a', path: '/a', createdAt: 0, lastOpenedAt: 0 },
    ],
    panes: [],
    layout: { paneIds: [] },
    lastProjectId: uuid(),
    settings: {},
  });
  settleProjects(state);
  assert.equal(state.lastProjectId, projectId);
});

test('a worktree is made on a new branch, and its uncommitted work saved and put back', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bonfire-worktrees-'));
  const run = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  try {
    const repository = join(root, 'repo');
    const worktree = join(root, 'worktrees', 'fuji');
    execFileSync('git', ['init', '-q', '-b', 'main', repository]);
    run(repository, 'config', 'user.email', 'test@example.com');
    run(repository, 'config', 'user.name', 'Test');
    await writeFile(join(repository, 'readme.md'), 'hi\n');
    await writeFile(join(repository, 'gone.md'), 'bye\n');
    await writeFile(join(repository, '.gitignore'), 'ignored.txt\n');
    run(repository, 'add', '.');
    run(repository, 'commit', '-q', '-m', 'init');

    // A new branch from the base, which it doesn't track.
    await git.addWorktree(repository, worktree, 'me/fuji', 'main');
    assert.equal(await git.currentBranch(worktree), 'me/fuji');
    assert.throws(() => run(worktree, 'rev-parse', '@{upstream}'));
    assert(await git.hasRef(repository, 'refs/heads/me/fuji'));
    await assert.rejects(
      () => git.addWorktree(repository, join(root, 'other'), 'me/fuji', 'main'),
      /already exists/,
    );

    // Edits, a new file, a deletion and a staged change are saved; ignored files aren't.
    await writeFile(join(worktree, 'readme.md'), 'changed\n');
    await writeFile(join(worktree, 'new.md'), 'new\n');
    await writeFile(join(worktree, 'ignored.txt'), 'local\n');
    run(worktree, 'rm', '-q', 'gone.md');
    const ref = 'refs/bonfire-archive/test';
    await git.saveWorkingTree(worktree, ref, 'Archive');
    assert.equal(run(worktree, 'diff', '--cached', '--name-only'), 'gone.md');
    await git.removeWorktree(repository, worktree);
    await assert.rejects(() => readFile(join(worktree, 'readme.md')));
    assert.equal(run(repository, 'show', `${ref}:new.md`), 'new');
    assert.throws(() => run(repository, 'show', `${ref}:ignored.txt`));

    // Checked out again, the work comes back uncommitted and unstaged.
    await git.addWorktree(repository, worktree, 'me/fuji');
    await git.restoreWorkingTree(worktree, ref);
    assert.equal(
      await readFile(join(worktree, 'readme.md'), 'utf8'),
      'changed\n',
    );
    assert.equal(await readFile(join(worktree, 'new.md'), 'utf8'), 'new\n');
    await assert.rejects(() => readFile(join(worktree, 'gone.md')));
    assert.equal(run(worktree, 'diff', '--cached', '--name-only'), '');
    assert.deepEqual(
      run(worktree, 'status', '--porcelain')
        .split('\n')
        .map((line) => line.trim()),
      ['D gone.md', 'M readme.md', '?? new.md'],
    );

    await git.removeWorktree(repository, worktree);
    await git.deleteBranch(repository, 'me/fuji');
    await git.deleteRef(repository, ref);
    assert.equal(await git.hasRef(repository, 'refs/heads/me/fuji'), false);
    assert.equal(await git.hasRef(repository, ref), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
