import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Pane, Project } from '../shared/contracts';
import { Store } from '../electron/main/persistence';
import { paneService } from '../electron/main/services/panes';
import type { Agents } from '../electron/main/services/agents';
import type { Scripts } from '../electron/main/scripts';
import type { Terminals } from '../electron/main/terminal';
import { MAX_TERMINAL_PANES } from '../shared/domain';

const uuid = () => crypto.randomUUID();

function newStore() {
  return new Store(mkdtempSync(join(tmpdir(), 'bonfire-state-')));
}

function project(lastOpenedAt = 0): Project {
  return {
    id: uuid(),
    name: 'Project',
    path: '/tmp',
    createdAt: 0,
    lastOpenedAt,
  };
}

function pane(projectId: string): Pane {
  return {
    id: uuid(),
    projectId,
    type: 'claude',
    title: 'Pane',
    messages: [],
    model: '',
    reasoningEffort: 'medium',
    fastMode: false,
    approvals: 'auto',
    archived: false,
  };
}

test('panes are added to either end of the layout, archived out of it, and reordered', () => {
  const store = newStore();
  const { id } = store.projects.add(project());
  const [first, second, view] = [pane(id), pane(id), pane(id)];
  store.panes.add(first, 'front');
  store.panes.add(second, 'front');
  store.panes.add(view, 'end');
  assert.deepEqual(store.state.layout.paneIds, [second.id, first.id, view.id]);

  store.panes.reorder([first.id, second.id, view.id]);
  assert.deepEqual(store.state.layout.paneIds, [first.id, second.id, view.id]);

  store.panes.archive(second);
  assert.equal(second.archived, true);
  assert.deepEqual(store.state.layout.paneIds, [first.id, view.id]);
  assert.equal(store.state.panes.length, 3);
});

test('a pane patch sets fields and clears those set to undefined', () => {
  const store = newStore();
  const { id } = store.projects.add(project());
  const item = store.panes.add(pane(id), 'front');
  store.panes.update(item, {
    title: 'Renamed',
    workBranch: { name: 'feature', since: 1 },
  });
  assert.equal(item.title, 'Renamed');
  assert.deepEqual(item.workBranch, { name: 'feature', since: 1 });
  store.panes.update(item, { workBranch: undefined });
  assert.equal('workBranch' in item, false);
});

test('messages are replaced by id, and only streaming ones take appended text', () => {
  const store = newStore();
  const { id } = store.projects.add(project());
  const item = store.panes.add(pane(id), 'front');
  const streaming = {
    id: 'm',
    role: 'assistant' as const,
    kind: 'text' as const,
    text: 'Hel',
    status: 'streaming' as const,
  };
  store.panes.putMessage(item, streaming);
  assert.equal(store.panes.append(item, 'm', 'text', 'lo')?.text, 'Hello');
  // Text output has nowhere to go without a tool.
  assert.equal(store.panes.append(item, 'm', 'output', 'x'), undefined);

  const finished = {
    ...streaming,
    text: 'Hello.',
    status: 'complete' as const,
  };
  store.panes.putMessage(item, finished);
  assert.deepEqual(item.messages, [finished]);
  assert.equal(store.panes.append(item, 'm', 'text', '!'), undefined);
  assert.equal(item.messages[0].text, 'Hello.');
});

test('removing a project takes its panes along and opens the latest other project', () => {
  const store = newStore();
  const [older, newer, removed] = [project(1), project(2), project(3)];
  for (const item of [older, newer, removed]) store.projects.add(item);
  const kept = store.panes.add(pane(newer.id), 'front');
  const open = store.panes.add(pane(removed.id), 'front');
  const archived = store.panes.add(pane(removed.id), 'front');
  store.panes.archive(archived);
  store.projects.open(removed);
  assert.equal(store.state.lastProjectId, removed.id);

  store.projects.remove(removed);
  assert.deepEqual(
    store.state.panes.map(({ id }) => id),
    [kept.id],
  );
  assert.deepEqual(store.state.layout.paneIds, [kept.id]);
  assert.equal(store.state.lastProjectId, newer.id);
  assert.equal(open.archived, false);

  store.projects.remove(older);
  store.projects.remove(newer);
  assert.equal(store.state.lastProjectId, undefined);
});

test('connections are put by id and removed', () => {
  const store = newStore();
  const connection = {
    id: uuid(),
    name: 'Box',
    host: 'dev@box',
    auth: 'default' as const,
  };
  store.connections.put(connection);
  store.connections.put({ ...connection, name: 'Build box' });
  assert.deepEqual(
    store.state.connections.map(({ name }) => name),
    ['Build box'],
  );
  store.connections.remove(connection.id);
  assert.deepEqual(store.state.connections, []);
});

test('a turn is remembered for the panes that start after it', () => {
  const store = newStore();
  store.settings.rememberTurn('claude', 'opus', 'high');
  store.settings.rememberTurn('codex', 'gpt', 'low');
  assert.deepEqual(store.state.settings, {
    lastProvider: 'codex',
    lastReasoningEffort: 'low',
    lastModels: { claude: 'opus', codex: 'gpt' },
  });
});

test('every change schedules a save', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const directory = mkdtempSync(join(tmpdir(), 'bonfire-state-'));
  const store = new Store(directory);
  const saved = async () => {
    t.mock.timers.tick(1000);
    await store.settled();
    return new Store(directory);
  };
  const item = store.projects.add(project());
  assert.equal((await saved()).project(item.id).name, 'Project');
  store.projects.update(item, { runScriptId: uuid() });
  assert.equal((await saved()).project(item.id).runScriptId, item.runScriptId);
  store.settings.setPreferences({ notifications: false });
  assert.equal((await saved()).preferences.notifications, false);
  const added = store.panes.add(pane(item.id), 'front');
  store.panes.update(added, { title: 'Renamed' });
  assert.equal((await saved()).pane(added.id).title, 'Renamed');
});

test('a project takes terminal panes up to the WebGL limit, and other panes past it', () => {
  const store = newStore();
  const item = store.projects.add(project());
  store.projects.open(item);
  const panes = paneService({
    store,
    agents: { requireEnabled() {}, discard() {} } as unknown as Agents,
    terminals: { closePane() {} } as unknown as Terminals,
    scripts: () => ({ forgetPane() {} }) as unknown as Scripts,
    emit() {},
  });
  for (let count = 0; count < MAX_TERMINAL_PANES; count++)
    panes.add('terminal');
  assert.throws(() => panes.add('terminal'), /up to 15 terminal panes/);
  assert.equal(panes.add('files').type, 'files');
  // Closing one makes room again.
  panes.archive(store.state.panes[0]);
  assert.equal(panes.add('terminal').type, 'terminal');
});
