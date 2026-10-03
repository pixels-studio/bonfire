import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pane } from '../shared/contracts';
import { DEFAULT_PREFERENCES } from '../shared/domain';
import { MergeWatcher } from '../electron/main/merge-watcher';
import type { Store } from '../electron/main/persistence';

function pane(id: string, branch: string, since: number): Pane {
  return {
    id,
    sessionId: 'session',
    type: 'claude',
    title: id,
    messages: [],
    model: '',
    reasoningEffort: 'medium',
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
    session: () => ({ worktreePath: '/nonexistent-repository' }),
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
