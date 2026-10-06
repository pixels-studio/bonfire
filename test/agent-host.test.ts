import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mainWorkspaceOf } from '../shared/domain';
import type { AssistantEvent, Pane } from '../shared/contracts';
import {
  AGENT_HOST_STOPPED,
  AgentClient,
  type AgentHostHandle,
  type AgentHostSetup,
} from '../electron/main/agent-client';
import { AgentMirror, type AgentChange } from '../electron/main/agent-store';
import {
  startAgentWorker,
  type AgentMethods,
} from '../electron/main/agent-worker';
import { assistantMessage } from '../electron/main/assistant';
import { Store } from '../electron/main/persistence';
import { HostStopped, Rpc, type Endpoint } from '../electron/main/rpc';
import { ScriptedAssistant, pair, sendInput, sleep } from './helpers';

/** A channel that can be cut, as a crash cuts it: nothing more gets through either way. */
function cuttablePair() {
  let cut = false;
  const receivers: ((message: unknown) => void)[][] = [[], []];
  const end = (self: number): Endpoint => ({
    post: (message) => {
      const copy = structuredClone(message);
      setImmediate(() => {
        if (!cut) receivers[1 - self].forEach((receive) => receive(copy));
      });
    },
    listen: (receive) => receivers[self].push(receive),
  });
  return { ends: [end(0), end(1)] as const, cut: () => (cut = true) };
}

/** The agent host run in this process, over a channel like the utility process's. */
function inProcessHost() {
  const assistants: ScriptedAssistant[] = [];
  let crash = () => {};
  const connect = (setup: AgentHostSetup): AgentHostHandle => {
    let rpc: Rpc<AgentMethods> | undefined;
    const start = () => {
      const { ends, cut } = cuttablePair();
      startAgentWorker(ends[1], (store, emit, host) => {
        const claude = new ScriptedAssistant(store, emit, host);
        assistants.push(claude);
        return { claude, codex: claude };
      });
      const started = new Rpc<AgentMethods>(ends[0], setup.handlers);
      rpc = started;
      setup.started(started);
      crash = () => {
        cut();
        rpc = undefined;
        started.fail(new HostStopped('Bonfire Agents'));
        setup.stopped();
      };
      return started;
    };
    return {
      get running() {
        return !!rpc;
      },
      call: ((method: string, ...args: unknown[]) =>
        (rpc ?? start()).call(method, ...args)) as AgentHostHandle['call'],
      close: async () => {
        await rpc?.call('close');
        rpc = undefined;
      },
    };
  };
  return { connect, assistants, crash: () => crash() };
}

function setUp() {
  const store = new Store(mkdtempSync(join(tmpdir(), 'bonfire-agents-')));
  const project = store.projects.add({
    id: crypto.randomUUID(),
    name: 'Project',
    path: process.cwd(),
    createdAt: 0,
    lastOpenedAt: 0,
  });
  const pane: Pane = store.panes.add(
    {
      id: 'pane',
      projectId: project.id,
      workspaceId: mainWorkspaceOf(store.state, project.id)!.id,
      type: 'claude',
      title: 'New Conversation',
      messages: [],
      model: '',
      reasoningEffort: 'medium',
      fastMode: false,
      approvals: 'auto',
      archived: false,
    },
    'front',
  );
  const events: AssistantEvent[] = [];
  const host = inProcessHost();
  const client = new AgentClient(
    store,
    (event) => events.push(event),
    {},
    host.connect,
  );
  return { store, pane, events, host, client };
}

const streaming = (id: string, text = '') =>
  assistantMessage(id, 'text', text, 'streaming');

test("a turn's stream reaches the window and main's copy of the conversation", async () => {
  const { pane, events, host, client } = setUp();
  await client.call('models', 'claude');
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  host.assistants[0].script = async ({ tools }, { pane: hostPane }) => {
    tools.publish(hostPane, streaming('m'), false);
    await sleep(40);
    tools.append(hostPane, 'm', 'text', 'Hel');
    tools.append(hostPane, 'm', 'text', 'lo');
    await held;
    tools.publish(hostPane, assistantMessage('m', 'text', 'Hello'));
  };
  const turn = client.send(sendInput('Hi'));
  await sleep(80);
  assert.equal(client.isRunning('pane'), true);
  // A snapshot mid-turn has every update sent before it, and nothing twice.
  const snapshot = await client.snapshot('pane');
  assert.equal(snapshot.running, true);
  assert.equal(snapshot.messages.at(-1)?.text, 'Hello');
  assert.equal(snapshot.messages.at(-1)?.status, 'streaming');
  release();
  await turn;
  await sleep(10);
  assert.equal(client.isRunning('pane'), false);
  assert.deepEqual(
    pane.messages.map(({ role, text, status }) => `${role}:${text}:${status}`),
    ['user:Hi:complete', 'assistant:Hello:complete'],
  );
  assert.deepEqual(
    events.map((event) =>
      event.type === 'delta'
        ? `delta:${event.text}`
        : event.type === 'status'
          ? `status:${event.status}`
          : event.type,
    ),
    [
      'message',
      'status:running',
      'message',
      'delta:Hello',
      'message',
      'status:completed',
      'status:idle',
    ],
  );
});

test('changes a turn makes to its pane and settings land in the Store', async () => {
  const { store, pane, host, client } = setUp();
  await client.send({ ...sendInput('Fix the dropdown'), model: 'b' });
  await sleep(10);
  assert.equal(pane.model, 'b');
  assert.equal(pane.title, 'Fix the dropdown');
  assert.deepEqual(store.state.settings.lastModels, { claude: 'b' });
  assert.equal(host.assistants.length, 1);
});

test('the host works on the latest state: a rename made in main reaches it before the next call', async () => {
  const { store, pane, host, client } = setUp();
  await client.call('models', 'claude');
  store.panes.update(pane, { title: 'Renamed' });
  let seen = '';
  await sleep(10);
  host.assistants[0].script = async (_assistant, turn) => {
    seen = turn.pane.title;
  };
  await client.send(sendInput());
  assert.equal(seen, 'Renamed');
});

test('a host that stops mid-turn leaves the pane settled, with the reason shown', async () => {
  const { pane, events, host, client } = setUp();
  await client.call('models', 'claude');
  host.assistants[0].script = async ({ tools }, { pane: hostPane }) => {
    tools.publish(hostPane, streaming('m', 'Half'), false);
    void tools.ask(hostPane, {
      kind: 'approval',
      title: 'Run command',
      detail: 'rm -rf build',
      canRemember: false,
    });
    await new Promise(() => {});
  };
  const turn = client.send(sendInput());
  await sleep(60);
  assert.equal(client.isRunning('pane'), true);
  host.crash();
  // The turn's own call ends quietly; the pane says what happened.
  await turn;
  assert.equal(client.isRunning('pane'), false);
  assert.deepEqual(
    pane.messages.slice(-2).map(({ text, status }) => `${text}:${status}`),
    ['Half:complete', `${AGENT_HOST_STOPPED}:failed`],
  );
  const shapes = events
    .slice(-5)
    .map((event) =>
      event.type === 'status' ? `status:${event.status}` : event.type,
    );
  assert.deepEqual(shapes, [
    'request-resolved',
    'message',
    'message',
    'status:failed',
    'status:idle',
  ]);
  // The next call starts a new host.
  assert.deepEqual(
    (await client.call('models', 'claude')).map(({ value }) => value),
    ['a', 'b'],
  );
  assert.equal(host.assistants.length, 2);
});

test('a snapshot needs no host when none is running', async () => {
  const { store, pane, host, client } = setUp();
  store.panes.putMessage(pane, assistantMessage('m', 'text', 'Earlier'));
  const snapshot = await client.snapshot('pane');
  assert.deepEqual(snapshot, {
    running: false,
    requests: [],
    queue: [],
    messages: pane.messages,
    usage: undefined,
  });
  assert.equal(host.assistants.length, 0);
});

test("the host's copy keeps its own changes until main's copy has them", () => {
  const changes: AgentChange[] = [];
  const mirror = new AgentMirror((change) => changes.push(change));
  const fields = {
    id: 'pane',
    projectId: 'project',
    type: 'claude' as const,
    title: 'Pane',
    model: '',
    reasoningEffort: 'medium' as const,
    fastMode: false,
    approvals: 'auto' as const,
    archived: false,
  };
  const copy = (panes: (typeof fields & { threadId?: string })[]) => ({
    projects: [],
    workspaces: [],
    connections: [],
    preferences: {},
    panes,
  });
  mirror.sync(copy([fields]), 0);
  const pane = mirror.pane('pane');
  mirror.panes.putMessage(pane, assistantMessage('m', 'text', 'Streamed'));
  mirror.panes.update(pane, { threadId: 'thread' });
  assert.deepEqual(changes, [
    { seq: 1, kind: 'pane', paneId: 'pane', patch: { threadId: 'thread' } },
  ]);

  // A copy sent before main made the change doesn't undo it, nor the pane's own messages.
  mirror.sync(copy([fields]), 0);
  assert.equal(mirror.pane('pane'), pane);
  assert.equal(pane.threadId, 'thread');
  assert.equal(pane.messages.length, 1);
  // Once main has it, main's copy decides, as when it clears the field later.
  mirror.sync(copy([{ ...fields, threadId: 'thread' }]), 1);
  mirror.sync(copy([fields]), 1);
  assert.equal('threadId' in pane, false);
  // A pane main no longer lists, such as one closed, is gone here too.
  mirror.sync(copy([]), 1);
  assert.throws(() => mirror.pane('pane'), /Pane not found/);
});

test("the host's copy is sent again only when the state changes, not when a conversation does", async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), 'bonfire-agents-')));
  const project = store.projects.add({
    id: crypto.randomUUID(),
    name: 'Project',
    path: process.cwd(),
    createdAt: 0,
    lastOpenedAt: 0,
  });
  const pane = store.panes.add(
    {
      id: 'pane',
      projectId: project.id,
      workspaceId: mainWorkspaceOf(store.state, project.id)!.id,
      type: 'claude',
      title: 'Pane',
      messages: [],
      model: '',
      reasoningEffort: 'medium',
      fastMode: false,
      approvals: 'auto',
      archived: false,
    },
    'front',
  );
  const calls: string[] = [];
  new AgentClient(
    store,
    () => {},
    {},
    (setup) => {
      const rpc = new Rpc<AgentMethods>(pair()[0]);
      setup.started(rpc);
      return {
        running: true,
        call: (async (method: string) => {
          calls.push(method);
        }) as AgentHostHandle['call'],
        close: async () => {},
      };
    },
  );
  await sleep(0);
  calls.length = 0;
  store.panes.putMessage(pane, assistantMessage('m', 'text', 'Hi'));
  store.save(pane);
  await sleep(0);
  assert.deepEqual(calls, []);
  // A burst of changes sends one copy.
  store.panes.update(pane, { title: 'Renamed' });
  store.panes.update(pane, { model: 'opus' });
  await sleep(0);
  assert.deepEqual(calls, ['sync']);
});

test('a message the host took down before its turn began is refused, not lost quietly', async () => {
  const { host, client } = setUp();
  await client.call('models', 'claude');
  // The host stops while the message is still being checked, before any turn starts.
  host.assistants[0].skillList = [];
  const sent = client.send({ ...sendInput(), skills: ['review'] });
  host.crash();
  await assert.rejects(sent, /agent process stopped unexpectedly/);
});

test("the host's own pane changes are confirmed, not sent back to it in a copy", async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), 'bonfire-agents-')));
  const project = store.projects.add({
    id: crypto.randomUUID(),
    name: 'Project',
    path: process.cwd(),
    createdAt: 0,
    lastOpenedAt: 0,
  });
  const pane = store.panes.add(
    {
      id: 'pane',
      projectId: project.id,
      workspaceId: mainWorkspaceOf(store.state, project.id)!.id,
      type: 'claude',
      title: 'Pane',
      messages: [],
      model: '',
      reasoningEffort: 'medium',
      fastMode: false,
      approvals: 'auto',
      archived: false,
    },
    'front',
  );
  const calls: string[] = [];
  let rpc!: Rpc<AgentMethods>;
  const [near, far] = pair();
  // The host's side, which only reports a change.
  const hostSide = new Rpc(far);
  new AgentClient(
    store,
    () => {},
    {},
    (setup) => {
      rpc = new Rpc<AgentMethods>(near);
      setup.started(rpc);
      return {
        running: true,
        call: (async (method: string) => {
          calls.push(method);
        }) as AgentHostHandle['call'],
        close: async () => {},
      };
    },
  );
  await sleep(10);
  calls.length = 0;
  hostSide.emit('change', {
    seq: 1,
    kind: 'pane',
    paneId: 'pane',
    patch: { threadId: 'thread' },
  });
  await sleep(10);
  assert.equal(pane.threadId, 'thread');
  assert.deepEqual(calls, ['confirm']);
});

test('a closed pane is shown from main, without asking the host', async () => {
  const { store, pane, host, client } = setUp();
  await client.call('models', 'claude');
  store.panes.archive(pane);
  const snapshot = await client.snapshot('pane');
  assert.equal(snapshot.running, false);
  assert.equal(host.assistants.length, 1);
});

test('connections that did not change keep their objects in the host', () => {
  const mirror = new AgentMirror(() => {});
  const connection = {
    id: 'c',
    name: 'Box',
    host: 'dev@box',
    auth: 'default' as const,
  };
  const copy = (connections: (typeof connection)[]) => ({
    projects: [],
    workspaces: [],
    connections: structuredClone(connections),
    preferences: {},
    panes: [],
  });
  mirror.sync(copy([connection]), 0);
  const [kept] = mirror.connections;
  mirror.sync(copy([connection]), 0);
  assert.equal(mirror.connections[0], kept);
  mirror.sync(copy([{ ...connection, host: 'dev@other' }]), 0);
  assert.notEqual(mirror.connections[0], kept);
});
