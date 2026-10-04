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
import { Store } from '../electron/main/persistence';

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
  assert.equal(reloaded.pane(archived).messages[0].text, 'old');
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
  busyPane.messages[0].text = 'edited';
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
  store.state.panes = store.state.panes.filter(({ id }) => id !== removed);
  store.save();
  store.flush();
  assert.deepEqual(conversationsOf(directory), [`${kept}.json`]);

  // A file nothing lists, as a crash between writes could leave, is cleared on load.
  writeFileSync(join(directory, 'conversations', `${uuid()}.json`), '[]');
  new Store(directory);
  assert.deepEqual(conversationsOf(directory), [`${kept}.json`]);
});

test('a scheduled save that fails is tried again rather than thrown or lost', (t) => {
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
  store.pane(id).messages[0].text = 'edited';
  store.save(store.pane(id));
  t.mock.timers.tick(1000);
  assert.equal(warn.mock.callCount(), 1);

  rmSync(file, { recursive: true });
  t.mock.timers.tick(5000);
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
