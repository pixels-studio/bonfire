import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pane, Workspace } from '../shared/contracts';
import { DEFAULT_PREFERENCES } from '../shared/domain';
import { MergeWatcher } from '../electron/main/merge-watcher';
import type { Store } from '../electron/main/persistence';

function pane(id: string, branch: string, since: number): Pane {
  return {
    id,
    projectId: 'project',
    workspaceId: 'main',
    type: 'claude',
    title: id,
    messages: [],
    model: '',
    reasoningEffort: 'medium',
    fastMode: false,
    approvals: 'auto',
    archived: false,
    workBranch: { name: branch, since },
  };
}

function workspace(
  id: string,
  branch: string | undefined,
  createdAt = 0,
  status: Workspace['status'] = 'in_progress',
): Workspace {
  return {
    id,
    projectId: 'project',
    name: id,
    branch,
    path: '/nonexistent-repository',
    main: !branch,
    status,
    createdAt,
  };
}

/** A store with the given panes and workspaces; a main workspace is always there. */
function storeWith(
  panes: Pane[],
  workspaces: Workspace[] = [],
  archiveOnMerge = true,
) {
  const all = [workspace('main', undefined), ...workspaces];
  return {
    state: { panes, workspaces: all },
    preferences: { ...DEFAULT_PREFERENCES, archiveOnMerge },
    workspace: (id: string) => all.find((item) => item.id === id)!,
  } as unknown as Store;
}

function watcher({
  panes,
  mergedAt,
  busy = [] as string[],
  archiveOnMerge = true,
}: {
  panes: Pane[];
  mergedAt: Record<string, number>;
  busy?: string[];
  archiveOnMerge?: boolean;
}) {
  const archived: string[] = [];
  const store = storeWith(panes, [], archiveOnMerge);
  const merges = new MergeWatcher({
    store,
    github: { lastMerge: async (_, branch) => mergedAt[branch] },
    isBusy: (id) => busy.includes(id),
    archive: (ids) => archived.push(...ids),
  });
  return { merges, archived };
}

test('panes whose pull request merged after they reached the branch are archived', async () => {
  const { merges, archived } = watcher({
    panes: [
      pane('merged', 'feature/a', 100),
      pane('stale-merge', 'feature/b', 500),
      pane('open', 'feature/c', 100),
    ],
    mergedAt: { 'feature/a': 200, 'feature/b': 200 },
  });
  await merges.check();
  assert.deepEqual(archived, ['merged']);
});

test('busy panes are left until their turn ends', async () => {
  const { merges, archived } = watcher({
    panes: [pane('busy', 'feature/a', 100)],
    mergedAt: { 'feature/a': 200 },
    busy: ['busy'],
  });
  await merges.check();
  assert.deepEqual(archived, []);
});

test('nothing is archived while auto-close is off', async () => {
  const { merges, archived } = watcher({
    panes: [pane('merged', 'feature/a', 100)],
    mergedAt: { 'feature/a': 200 },
    archiveOnMerge: false,
  });
  await merges.check();
  assert.deepEqual(archived, []);
});

test('checks wait while the app is out of view, and catch up once it is back', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let inView = false;
  const archived: string[] = [];
  const store = storeWith([pane('merged', 'feature/a', 100)]);
  let lookups = 0;
  const merges = new MergeWatcher({
    store,
    github: {
      lastMerge: async () => {
        lookups++;
        return 200;
      },
    },
    isBusy: () => false,
    archive: (ids) => archived.push(...ids),
    inView: () => inView,
  });
  merges.start();
  t.mock.timers.tick(60_000);
  t.mock.timers.tick(60_000);
  assert.equal(lookups, 0);
  inView = true;
  await merges.catchUp();
  assert.equal(lookups, 1);
  assert.deepEqual(archived, ['merged']);
  await merges.catchUp();
  assert.equal(lookups, 1, 'nothing was missed since');
  merges.close();
});

test('a workspace is done once its branch merges after it was made, auto-close or not', async () => {
  const done: string[] = [];
  const merges = new MergeWatcher({
    store: storeWith(
      [],
      [
        workspace('merged', 'me/fuji', 100),
        workspace('older-merge', 'me/uluru', 500),
        workspace('open', 'me/zion', 100),
        workspace('already-done', 'me/bryce', 100, 'done'),
      ],
      false,
    ),
    github: {
      lastMerge: async (_, branch) =>
        ({ 'me/fuji': 200, 'me/uluru': 200, 'me/bryce': 200 })[branch],
    },
    isBusy: () => false,
    archive: () => assert.fail('nothing is archived with auto-close off'),
    done: (ids) => done.push(...ids),
  });
  await merges.check();
  assert.deepEqual(done, ['merged']);
});
