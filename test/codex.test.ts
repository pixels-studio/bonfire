import assert from 'node:assert/strict';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { AssistantEvent } from '../shared/contracts';
import { CodexAssistant } from '../electron/main/codex';
import { SshMachine } from '../electron/main/machines';
import { SIMPLIFIED_ENGLISH_INSTRUCTIONS } from '../shared/domain';
import { fakeStore, host, sendInput, sleep } from './helpers';

const FIXTURE = join(process.cwd(), 'test/fixtures/fake-codex.mjs');
const open: CodexAssistant[] = [];
afterEach(() => {
  for (const assistant of open.splice(0)) assistant.close();
});

function codex(fixture = FIXTURE) {
  const { pane, store } = fakeStore('codex');
  const events: AssistantEvent[] = [];
  const opened: string[] = [];
  const assistant = new CodexAssistant(
    store,
    (event) => events.push(event),
    { ...host, openUrl: async (url) => void opened.push(url) },
    () => ({ file: process.execPath, args: [fixture] }),
  );
  open.push(assistant);
  // The approval flow is what these tests exercise.
  const send = (text: string) =>
    assistant.send({ ...sendInput(text), approvals: 'ask' });
  const waitFor = async (match: (event: AssistantEvent) => boolean) => {
    for (let tries = 0; tries < 200; tries++) {
      const found = events.find(match);
      if (found) return found;
      await sleep(10);
    }
    throw new Error('Timed out waiting for an event');
  };
  return { assistant, pane, store, events, opened, send, waitFor };
}

test('a turn streams text, reasoning, and usage, and remembers the thread', async () => {
  const { pane, events, send } = codex();
  await send('hello');

  assert.match(pane.threadId ?? '', /^thread-/);
  const reply = pane.messages.find((item) => item.id === 'a1');
  assert.deepEqual([reply?.text, reply?.status], ['Hello!', 'complete']);
  const thinking = pane.messages.find((item) => item.id === 'r1');
  assert.equal(thinking?.text, 'Think\n\nNext');
  assert.deepEqual(pane.usage, {
    inputTokens: 400,
    cachedInputTokens: 600,
    outputTokens: 60,
    reasoningOutputTokens: 40,
    contextWindow: 258000,
  });
  // Streaming text arrived as deltas, not as whole messages.
  assert(
    events.some((event) => event.type === 'delta' && event.field === 'text'),
  );
  assert.deepEqual(events.at(-1), {
    paneId: 'pane',
    type: 'status',
    status: 'idle',
  });
});

test('a second turn resumes the same thread', async () => {
  const { pane, send } = codex();
  await send('hello');
  const first = pane.threadId;
  await send('hello again');
  assert.equal(pane.threadId, first);
});

test('command output streams into the tool call', async () => {
  const { pane, events, send } = codex();
  await send('stream');
  const tool = pane.messages.find((item) => item.id === 'c1');
  assert.deepEqual(tool?.tool, {
    name: 'Bash',
    input: 'ls',
    output: 'one\ntwo\n',
  });
  assert.equal(tool?.status, 'complete');
  assert(
    events.some((event) => event.type === 'delta' && event.field === 'output'),
  );
});

test('approving a command lets it run', async () => {
  const { assistant, pane, send, waitFor } = codex();
  const turn = send('approve');
  const request = await waitFor((event) => event.type === 'request');
  assert(request.type === 'request' && request.request.kind === 'approval');
  assert.equal(request.request.detail, 'touch x');
  assert.equal(request.request.reason, 'Needs write access');
  assistant.respond({
    paneId: 'pane',
    requestId: request.request.id,
    decision: 'allow',
  });
  await turn;
  assert.equal(
    pane.messages.find((item) => item.id === 'a1')?.text,
    'decision:accept',
  );
  assert.equal(
    pane.messages.find((item) => item.id === 'c1')?.status,
    'complete',
  );
});

test('allowing for the session and denying are passed on', async () => {
  for (const [decision, expected] of [
    ['allow-session', 'acceptForSession'],
    ['deny', 'decline'],
  ] as const) {
    const { assistant, pane, send, waitFor } = codex();
    const turn = send('approve');
    const request = await waitFor((event) => event.type === 'request');
    assert(request.type === 'request');
    assistant.respond({
      paneId: 'pane',
      requestId: request.request.id,
      decision,
    });
    await turn;
    assert.equal(
      pane.messages.find((item) => item.id === 'a1')?.text,
      `decision:${expected}`,
    );
  }
});

test('questions from the model are answered by the user', async () => {
  const { assistant, pane, send, waitFor } = codex();
  const turn = send('ask');
  const request = await waitFor((event) => event.type === 'request');
  assert(request.type === 'request' && request.request.kind === 'question');
  assert.equal(request.request.questions[0].options[0].label, 'A');
  assistant.respond({
    paneId: 'pane',
    requestId: request.request.id,
    answers: { which: ['A'] },
  });
  await turn;
  assert.equal(
    pane.messages.find((item) => item.id === 'a1')?.text,
    'answers:{"which":{"answers":["A"]}}',
  );
});

test('cancelling interrupts the turn without an error', async () => {
  const { assistant, pane, events, send, waitFor } = codex();
  const turn = send('hang');
  await waitFor(
    (event) =>
      event.type === 'delta' ||
      (event.type === 'message' && event.message.id === 'a1'),
  );
  assistant.cancel('pane');
  await turn;
  assert(!pane.messages.some((item) => item.kind === 'error'));
  assert(pane.messages.every((item) => item.status !== 'streaming'));
  assert(
    !events.some(
      (event) => event.type === 'status' && event.status === 'failed',
    ),
  );
});

test('cancelling while waiting on an approval refuses it', async () => {
  const { assistant, pane, send, waitFor } = codex();
  const turn = send('approve');
  await waitFor((event) => event.type === 'request');
  assistant.cancel('pane');
  await turn;
  assert.equal(
    pane.messages.find((item) => item.id === 'a1')?.text,
    'decision:cancel',
  );
});

test('a failed turn shows one readable error', async () => {
  const { pane, events, send } = codex();
  await send('fail');
  const errors = pane.messages.filter((item) => item.kind === 'error');
  assert.deepEqual(
    errors.map((item) => item.text),
    ['Model not supported'],
  );
  assert(
    events.some(
      (event) => event.type === 'status' && event.status === 'failed',
    ),
  );
});

test('a capacity error is flagged separately from a regular one', async () => {
  const { pane, events, send } = codex();
  await send('capacity');
  assert(!pane.messages.some((item) => item.kind === 'error'));
  const capacity = pane.messages.filter((item) => item.kind === 'capacity');
  assert.deepEqual(
    capacity.map((item) => item.text),
    ['The selected model is at capacity. Please try again.'],
  );
  assert(
    events.some(
      (event) => event.type === 'status' && event.status === 'failed',
    ),
  );
});

test('an error that Codex retries is not shown', async () => {
  const { pane, send } = codex();
  await send('retry');
  assert(!pane.messages.some((item) => item.kind === 'error'));
  assert.equal(pane.messages.find((item) => item.id === 'a1')?.text, 'ok');
});

test('the server dying mid-turn fails the turn, and the next turn starts a new server', async () => {
  const { pane, send } = codex();
  await send('crash');
  const error = pane.messages.find((item) => item.kind === 'error');
  assert.match(error?.text ?? '', /exited unexpectedly/);
  await send('hello');
  assert.equal(pane.messages.find((item) => item.id === 'a1')?.text, 'Hello!');
});

test('a server that cannot start fails the turn and is retried next time', async () => {
  const { pane, send } = codex('/nonexistent/fake-codex.mjs');
  await send('hello');
  assert(pane.messages.some((item) => item.kind === 'error'));
  await send('hello');
  assert.equal(pane.messages.filter((item) => item.kind === 'error').length, 2);
});

test('models come from the server and hide hidden ones', async () => {
  const { assistant } = codex();
  assert.deepEqual(await assistant.models(), [
    { value: 'fake-1', label: 'Fake 1' },
  ]);
});

test('a message sent mid-turn steers it', async () => {
  const { assistant, pane, events, send, waitFor } = codex();
  const turn = send('steerable');
  // The turn's first item arrives after Codex has given the turn an id to steer.
  await waitFor(
    (event) => event.type === 'message' && event.message.id === 'w1',
  );
  await assistant.send({ ...sendInput('also add tests'), followUp: 'steer' });
  await turn;
  assert.equal(
    pane.messages.find((item) => item.id === 'a1')?.text,
    'Steered: also add tests',
  );
  assert(
    pane.messages.some(
      (item) => item.role === 'user' && item.text === 'also add tests',
    ),
  );
  assert(!events.some((event) => event.type === 'queue' && event.queue.length));
});

test('the chosen personality is sent with the turn', async () => {
  const { pane, store, send } = codex();
  store.preferences.codexPersonality = 'friendly';
  await send('personality');
  assert.equal(
    pane.messages.find((item) => item.id === 'a1')?.text,
    'personality:friendly',
  );
});

test('skills are listed for the project, without turned-off ones', async () => {
  const { assistant } = codex();
  assert.deepEqual(await assistant.skills('pane'), [
    {
      name: 'review',
      description: 'Reviews the diff',
      path: '/skills/review/SKILL.md',
    },
  ]);
});

test('an attached skill is sent by the path Codex listed it at', async () => {
  const { assistant, pane } = codex();
  await assistant.send({
    ...sendInput('skills please'),
    skills: ['review'],
  });
  assert.equal(
    pane.messages.find((item) => item.id === 'a1')?.text,
    'skills:review@/skills/review/SKILL.md',
  );
  assert(pane.messages.some((item) => item.text === '/review skills please'));
});

test('Simplified English is sent as developer instructions when on', async () => {
  const { pane, store, send } = codex();
  store.preferences.simplifiedEnglish = true;
  await send('instructions');
  assert.equal(
    pane.messages.find((item) => item.id === 'a1')?.text,
    `instructions:${SIMPLIFIED_ENGLISH_INSTRUCTIONS}`,
  );
});

test('no developer instructions are sent when Simplified English is off', async () => {
  const { pane, send } = codex();
  await send('instructions');
  assert.equal(
    pane.messages.find((item) => item.id === 'a1')?.text,
    'instructions:none set',
  );
});

test('the default personality is left to Codex', async () => {
  const { pane, send } = codex();
  await send('personality');
  assert.equal(
    pane.messages.find((item) => item.id === 'a1')?.text,
    'personality:none set',
  );
});

test('the signed-in account is read from the server', async () => {
  const { assistant } = codex();
  assert.deepEqual(await assistant.account(), {
    provider: 'codex',
    signedIn: true,
    email: 'me@example.com',
    plan: 'plus',
  });
});

test('signing in opens the browser and waits for the server to finish', async () => {
  const { assistant, opened } = codex();
  const account = await assistant.connect();
  assert.deepEqual(opened, ['https://auth.example/login']);
  assert.equal(account.email, 'me@example.com');
});

test('text is generated on an ephemeral thread', async () => {
  const { assistant, pane } = codex();
  assert.equal(
    await assistant.generate('Write a title for this', 'fake-1'),
    '"Fix the login flow."',
  );
  assert.equal(pane.messages.length, 0);
});

test('a workspace on an SSH machine gets a Codex server of its own there', async () => {
  const { pane, store } = fakeStore('codex');
  const machine = new SshMachine(
    { id: crypto.randomUUID(), name: 'Box', host: 'dev@box', auth: 'default' },
    join(process.cwd(), 'test/fixtures/fake-ssh.sh'),
  );
  const started: string[] = [];
  const assistant = new CodexAssistant(
    store,
    () => {},
    { ...host, machineOf: () => machine },
    (target) => {
      started.push(target.id);
      return {
        file: process.execPath,
        args: [FIXTURE],
        machine: target.remote ? target : undefined,
      };
    },
  );
  open.push(assistant);
  await assistant.send(sendInput('hello'));
  assert.equal(pane.messages.find((item) => item.id === 'a1')?.text, 'Hello!');
  await assistant.models();
  assert.deepEqual(started, [machine.id, 'local']);
});
