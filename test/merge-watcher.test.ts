import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pane } from '../shared/contracts';
import { DEFAULT_PREFERENCES } from '../shared/domain';
import { MergeWatcher } from '../electron/main/merge-watcher';
import type { Store } from '../electron/main/persistence';

function pane(id: string, branch: string, since: number): Pane {
  return {
    id,
    projectId: 'project',
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
  const store = {
    state: { panes },
    preferences: { ...DEFAULT_PREFERENCES, archiveOnMerge },
    project: () => ({ path: '/nonexistent-repository' }),
  } as unknown as Store;
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
  const store = {
    state: { panes: [pane('merged', 'feature/a', 100)] },
    preferences: { ...DEFAULT_PREFERENCES, archiveOnMerge: true },
    project: () => ({ path: '/nonexistent-repository' }),
  } as unknown as Store;
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
