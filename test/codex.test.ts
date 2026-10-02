import assert from 'node:assert/strict';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { AssistantEvent } from '../shared/contracts';
import { CodexAssistant } from '../electron/main/codex';
import { fakeStore, sendInput, sleep } from './helpers';

const FIXTURE = join(process.cwd(), 'test/fixtures/fake-codex.mjs');
const open: CodexAssistant[] = [];
afterEach(() => {
  for (const assistant of open.splice(0)) assistant.close();
});

function codex(fixture = FIXTURE) {
  const { pane, store } = fakeStore('codex');
  const events: AssistantEvent[] = [];
  const assistant = new CodexAssistant(
    store,
    (event) => events.push(event),
    async () => undefined,
    () => ({ file: process.execPath, args: [fixture] }),
  );
  open.push(assistant);
  assistant.approvals = 'ask'; // the approval flow is what these tests exercise
  const send = (text: string) => assistant.send(sendInput(text));
  const waitFor = async (match: (event: AssistantEvent) => boolean) => {
    for (let tries = 0; tries < 200; tries++) {
      const found = events.find(match);
      if (found) return found;
      await sleep(10);
    }
    throw new Error('Timed out waiting for an event');
  };
  return { assistant, pane, events, send, waitFor };
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
