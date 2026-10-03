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

test('branches are created, listed, and switched with uncommitted work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bonfire-branches-'));
  const run = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  try {
    const remote = join(root, 'remote.git');
    const repository = join(root, 'repo');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
    execFileSync('git', ['init', '-q', '-b', 'main', repository]);
    run(repository, 'config', 'user.email', 'test@example.com');
    run(repository, 'config', 'user.name', 'Test');
    assert.deepEqual(await git.head(repository), {
      isGit: true,
      branch: 'main',
    });
    await writeFile(join(repository, 'readme.md'), 'hi\n');
    run(repository, 'add', '.');
    run(repository, 'commit', '-q', '-m', 'init');
    run(repository, 'remote', 'add', 'origin', remote);
    run(repository, 'push', '-q', '-u', 'origin', 'main');

    // Uncommitted work comes along to a new branch, which doesn't track its base.
    await writeFile(join(repository, 'readme.md'), 'changed\n');
    await git.createBranch(repository, 'feature/a', 'origin/main');
    assert.equal(await git.currentBranch(repository), 'feature/a');
    assert.equal(
      await readFile(join(repository, 'readme.md'), 'utf8'),
      'changed\n',
    );
    assert.throws(() => run(repository, 'rev-parse', '@{upstream}'));
    run(repository, 'commit', '-q', '-am', 'Change readme');
    await assert.rejects(
      () => git.createBranch(repository, 'bad name', 'main'),
      /isn’t a valid branch name/,
    );
    await assert.rejects(
      () => git.createBranch(repository, 'feature/a', 'main'),
      /already exists/,
    );

    // Changes that would be overwritten stop the switch, in git's words.
    await writeFile(join(repository, 'readme.md'), 'conflicting\n');
    await assert.rejects(
      () => git.switchBranch(repository, 'main'),
      (cause: Error) =>
        cause.message ===
        'Switching would overwrite uncommitted changes to readme.md. Commit or stash them first.',
    );
    assert.equal(await git.currentBranch(repository), 'feature/a');
    run(repository, 'checkout', '-q', '--', 'readme.md');
    await git.switchBranch(repository, 'main');
    assert.equal(await git.currentBranch(repository), 'main');

    const branches = await git.localBranches(repository);
    assert.deepEqual(branches.map(({ name }) => name).sort(), [
      'feature/a',
      'main',
    ]);
    const feature = branches.find(({ name }) => name === 'feature/a')!;
    assert.equal(feature.subject, 'Change readme');
    assert(feature.committedAt > Date.now() - 60_000);

    // Pulling only fast-forwards.
    const clone = join(root, 'clone');
    execFileSync('git', ['clone', '-q', remote, clone]);
    run(clone, 'config', 'user.email', 'test@example.com');
    run(clone, 'config', 'user.name', 'Test');
    await writeFile(join(clone, 'new.md'), 'new\n');
    run(clone, 'add', '.');
    run(clone, 'commit', '-q', '-m', 'Merged elsewhere');
    run(clone, 'push', '-q');
    await git.pull(repository);
    assert.equal(
      run(repository, 'log', '-1', '--format=%s'),
      'Merged elsewhere',
    );

    run(repository, 'checkout', '-q', '--detach');
    assert.deepEqual(await git.head(repository), { isGit: true });
    assert.deepEqual(await git.head(root), { isGit: false });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
