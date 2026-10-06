import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  Store,
  settleLayout,
  stateForWindow,
} from '../electron/main/persistence';
import type { State } from '../shared/contracts';

const uuid = () => crypto.randomUUID();

function message(text: string, status = 'complete') {
  return { id: uuid(), role: 'assistant', kind: 'text', text, status };
}

function pane(
  id: string,
  projectId: string,
  messages: unknown[],
  archived = false,
) {
  return { id, projectId, type: 'claude', title: 'Pane', messages, archived };
}

/** State as versions before conversation files saved it: every message inline. */
function legacyState(projectId: string, panes: unknown[], paneIds: string[]) {
  return {
    version: 1,
    projects: [
      {
        id: projectId,
        name: 'p',
        path: '/tmp/p',
        createdAt: 0,
        lastOpenedAt: 0,
      },
    ],
    panes,
    layout: { paneIds },
    lastProjectId: projectId,
    settings: {},
  };
}

const conversationsOf = (directory: string) =>
  readdirSync(join(directory, 'conversations')).sort();

test('inline conversations move to their own files and load back', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bonfire-store-'));
  const projectId = uuid();
  const [open, archived] = [uuid(), uuid()];
  writeFileSync(
    join(directory, 'state.json'),
    JSON.stringify(
      legacyState(
        projectId,
        [
          pane(open, projectId, [
            message('hello'),
            message('cut off', 'streaming'),
          ]),
          pane(archived, projectId, [message('old')], true),
        ],
        [open, archived],
      ),
    ),
  );

  const store = new Store(directory);
  // A streaming message left by a crash is settled on load.
  assert.equal(store.pane(open).messages[1].status, 'complete');
  // Closed panes no longer sit in the layout.
  assert.deepEqual(store.state.layout.paneIds, [open]);
  store.flush();

  const saved = JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8'));
  assert(saved.panes.every((item: object) => !('messages' in item)));
  assert.deepEqual(
    conversationsOf(directory),
    [`${archived}.json`, `${open}.json`].sort(),
  );

  const reloaded = new Store(directory);
  assert.deepEqual(
    reloaded.pane(open).messages.map(({ text }) => text),
    ['hello', 'cut off'],
  );
  // The archived one stays on disk, where reloading it left it.
  assert.equal(
    JSON.parse(
      readFileSync(
        join(directory, 'conversations', `${archived}.json`),
        'utf8',
      ),
    )[0].text,
    'old',
  );
});

test('a save rewrites only the conversations that changed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bonfire-store-'));
  const projectId = uuid();
  const [busy, quiet] = [uuid(), uuid()];
  writeFileSync(
    join(directory, 'state.json'),
    JSON.stringify(
      legacyState(
        projectId,
        [
          pane(busy, projectId, [message('a')]),
          pane(quiet, projectId, [message('b')]),
        ],
        [busy, quiet],
      ),
    ),
  );
  new Store(directory).flush();

  const store = new Store(directory);
  const quietFile = join(directory, 'conversations', `${quiet}.json`);
  const before = statSync(quietFile).mtimeMs;
  const busyPane = store.pane(busy);
  busyPane.messages[0] = { ...busyPane.messages[0], text: 'edited' };
  store.save(busyPane);
  // A message added without naming the pane is still caught by its count.
  store.pane(quiet).title = 'Renamed';
  store.save();
  store.flush();
  assert.equal(statSync(quietFile).mtimeMs, before);

  const reloaded = new Store(directory);
  assert.equal(reloaded.pane(busy).messages[0].text, 'edited');
  assert.equal(reloaded.pane(quiet).title, 'Renamed');

  reloaded.pane(quiet).messages.push(message('unreported') as never);
  reloaded.save();
  reloaded.flush();
  assert.equal(new Store(directory).pane(quiet).messages.length, 2);
});

test('removed panes take their conversation files with them', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bonfire-store-'));
  const projectId = uuid();
  const [kept, removed] = [uuid(), uuid()];
  writeFileSync(
    join(directory, 'state.json'),
    JSON.stringify(
      legacyState(
        projectId,
        [
          pane(kept, projectId, [message('k')]),
          pane(removed, projectId, [message('r')]),
        ],
        [kept, removed],
      ),
    ),
  );
  const store = new Store(directory);
  store.flush();
  store.panes.remove([removed]);
  store.flush();
  assert.deepEqual(conversationsOf(directory), [`${kept}.json`]);

  // A file nothing lists, as a crash between writes could leave, is cleared on load.
  writeFileSync(join(directory, 'conversations', `${uuid()}.json`), '[]');
  new Store(directory);
  assert.deepEqual(conversationsOf(directory), [`${kept}.json`]);
});

test('a scheduled save lands in the background, and a flush meanwhile wins', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const directory = mkdtempSync(join(tmpdir(), 'bonfire-store-'));
  const projectId = uuid();
  const id = uuid();
  writeFileSync(
    join(directory, 'state.json'),
    JSON.stringify(
      legacyState(projectId, [pane(id, projectId, [message('x')])], [id]),
    ),
  );
  new Store(directory).flush();

  const store = new Store(directory);
  // As the app does, a finished message changes by being replaced.
  const setText = (text: string) => {
    const { messages } = store.pane(id);
    messages[0] = { ...messages[0], text };
  };
  setText('scheduled');
  store.save(store.pane(id));
  t.mock.timers.tick(1000);
  await store.settled();
  assert.equal(new Store(directory).pane(id).messages[0].text, 'scheduled');

  // A write on the thread while a background one is underway carries the newer text, and
  // the older copy never lands over it.
  setText('older');
  store.save(store.pane(id));
  t.mock.timers.tick(1000);
  // Lets the background write serialize 'older' and reach the disk.
  await Promise.resolve();
  setText('newer');
  store.flush();
  await store.settled();
  assert.equal(new Store(directory).pane(id).messages[0].text, 'newer');
  assert.deepEqual(conversationsOf(directory), [`${id}.json`]);
});

test('a scheduled save that fails is tried again rather than thrown or lost', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const warn = t.mock.method(console, 'warn', () => {});
  const directory = mkdtempSync(join(tmpdir(), 'bonfire-store-'));
  const projectId = uuid();
  const id = uuid();
  writeFileSync(
    join(directory, 'state.json'),
    JSON.stringify(
      legacyState(projectId, [pane(id, projectId, [message('x')])], [id]),
    ),
  );
  new Store(directory).flush();

  const store = new Store(directory);
  // A folder in the conversation's place makes its write fail, as a locked file would.
  const file = join(directory, 'conversations', `${id}.json`);
  rmSync(file);
  mkdirSync(join(file, 'blocker'), { recursive: true });
  store.pane(id).messages[0] = {
    ...store.pane(id).messages[0],
    text: 'edited',
  };
  store.save(store.pane(id));
  t.mock.timers.tick(1000);
  await store.settled();
  assert.equal(warn.mock.callCount(), 1);

  rmSync(file, { recursive: true });
  t.mock.timers.tick(5000);
  await store.settled();
  assert.equal(new Store(directory).pane(id).messages[0].text, 'edited');
});

test('a missing or damaged conversation file loads as an empty conversation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bonfire-store-'));
  const projectId = uuid();
  const id = uuid();
  writeFileSync(
    join(directory, 'state.json'),
    JSON.stringify(
      legacyState(projectId, [pane(id, projectId, [message('x')])], [id]),
    ),
  );
  new Store(directory).flush();
  writeFileSync(join(directory, 'conversations', `${id}.json`), '{not json');
  assert.deepEqual(new Store(directory).pane(id).messages, []);
  assert(existsSync(join(directory, 'state.json')));
});

test('an older version run afterwards neither loses nor hides conversations', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bonfire-store-'));
  const projectId = uuid();
  const [untouched, continued] = [uuid(), uuid()];
  const legacy = (messages: Record<string, unknown[]>) =>
    JSON.stringify(
      legacyState(
        projectId,
        [
          pane(untouched, projectId, messages[untouched]),
          pane(continued, projectId, messages[continued]),
        ],
        [untouched, continued],
      ),
    );
  writeFileSync(
    join(directory, 'state.json'),
    legacy({ [untouched]: [message('kept')], [continued]: [message('one')] }),
  );
  new Store(directory).flush();
  // The state as first found is kept aside.
  assert(existsSync(join(directory, 'state.before-conversations.json')));

  // An older version sees no messages in state.json, saves an empty list for one pane, and
  // carries on the other conversation inline.
  writeFileSync(
    join(directory, 'state.json'),
    legacy({
      [untouched]: [],
      [continued]: [message('one'), message('two')],
    }),
  );
  const store = new Store(directory);
  assert.equal(store.pane(untouched).messages[0]?.text, 'kept');
  assert.deepEqual(
    store.pane(continued).messages.map(({ text }) => text),
    ['one', 'two'],
  );
});

test('a project keeps only its first files and code diff panes, where they sit', () => {
  const view = (id: string, projectId: string, type: string) => ({
    ...pane(id, projectId, []),
    type,
  });
  const state = {
    panes: [
      view('agent', 'a', 'claude'),
      view('files', 'a', 'files'),
      view('files-again', 'a', 'files'),
      view('diff', 'a', 'diff'),
      view('terminal', 'a', 'terminal'),
      view('terminal-again', 'a', 'terminal'),
      view('other-files', 'b', 'files'),
    ],
    layout: {
      paneIds: [
        'files',
        'agent',
        'files-again',
        'diff',
        'terminal',
        'terminal-again',
        'other-files',
      ],
    },
  } as unknown as State;
  settleLayout(state);
  assert.deepEqual(state.layout.paneIds, [
    'files',
    'agent',
    'diff',
    'terminal',
    'terminal-again',
    'other-files',
  ]);
  assert.ok(state.panes.find(({ id }) => id === 'files-again')!.archived);
});

test('the window gets conversations only for the open panes of the project on screen', () => {
  const shown = pane('shown', 'a', [message('kept')]);
  const state = {
    panes: [
      shown,
      pane('closed', 'a', [message('archived')], true),
      pane('elsewhere', 'b', [message('other project')]),
    ],
    lastProjectId: 'a',
  } as unknown as State;
  const sent = stateForWindow(state);
  assert.deepEqual(
    sent.panes.map(({ id, messages }) => [id, messages.length]),
    [
      ['shown', 1],
      ['closed', 0],
      ['elsewhere', 0],
    ],
  );
  assert.equal(sent.panes[0], shown);
  // What main keeps is untouched.
  assert.equal(state.panes[2].messages.length, 1);
});

test('archived conversations stay on disk unread, untouched, and go with their pane', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bonfire-store-'));
  const projectId = uuid();
  const [open, archived, orphan] = [uuid(), uuid(), uuid()];
  writeFileSync(
    join(directory, 'state.json'),
    JSON.stringify(
      legacyState(
        projectId,
        [
          pane(open, projectId, [message('open')]),
          pane(archived, projectId, [message('old'), message('older')], true),
          {
            ...pane(orphan, '', [message('orphan')], true),
            projectId: undefined,
          },
        ],
        [open],
      ),
    ),
  );
  new Store(directory).flush();
  const archivedFile = join(directory, 'conversations', `${archived}.json`);
  const onDisk = readFileSync(archivedFile, 'utf8');

  const store = new Store(directory);
  assert.equal(store.pane(open).messages.length, 1);
  assert.deepEqual(store.pane(archived).messages, []);
  // One without a project is read, as an empty one would be dropped.
  assert.equal(store.pane(orphan).messages.length, 1);
  // Even a save that names it leaves its file as it was.
  store.save(store.pane(archived));
  store.flush();
  assert.equal(readFileSync(archivedFile, 'utf8'), onDisk);
  assert.equal(JSON.parse(onDisk).length, 2);

  store.panes.remove([archived]);
  store.flush();
  assert.equal(existsSync(archivedFile), false);
});

test('saves reuse finished messages, yet write replaced and streaming ones as they are', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bonfire-store-'));
  const projectId = uuid();
  const id = uuid();
  writeFileSync(
    join(directory, 'state.json'),
    JSON.stringify(
      legacyState(
        projectId,
        [pane(id, projectId, [message('first'), message('second')])],
        [id],
      ),
    ),
  );
  const store = new Store(directory);
  store.flush();
  const file = join(directory, 'conversations', `${id}.json`);
  const conversation = store.pane(id);
  const read = () => readFileSync(file, 'utf8');
  assert.equal(read(), JSON.stringify(conversation.messages));

  // A finished message changes by being replaced.
  conversation.messages[1] = { ...conversation.messages[1], text: 'replaced' };
  // A streaming one grows in place.
  const streaming = message(
    'grow',
    'streaming',
  ) as never as (typeof conversation.messages)[0];
  conversation.messages.push(streaming);
  store.save(conversation);
  store.flush();
  streaming.text += 'ing';
  store.save(conversation);
  store.flush();
  assert.equal(read(), JSON.stringify(conversation.messages));
  assert.deepEqual(
    JSON.parse(read()).map(({ text }: { text: string }) => text),
    ['first', 'replaced', 'growing'],
  );
});
