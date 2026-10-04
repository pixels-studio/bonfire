import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssistantEvent } from '../shared/contracts';
import { scripted, sendInput, sleep } from './helpers';

const lastQueue = (events: AssistantEvent[]) =>
  events.findLast((event) => event.type === 'queue');

const userTexts = (messages: { role: string; kind: string; text: string }[]) =>
  messages
    .filter((item) => item.role === 'user' && item.kind === 'text')
    .map((item) => item.text);

test('a queued follow-up waits, then runs once the turn completes', async () => {
  const { assistant, pane, events } = scripted();
  const prompts: string[] = [];
  assistant.script = async (_, turn) => {
    prompts.push(turn.input.text);
    await sleep(30);
  };
  const first = assistant.send(sendInput('first'));
  await assistant.send({ ...sendInput('second'), followUp: 'queue' });
  const queued = lastQueue(events);
  assert(queued?.type === 'queue');
  assert.deepEqual(
    queued.queue.map(({ text }) => text),
    ['second'],
  );
  // Only the first message is shown until its turn ends.
  assert.deepEqual(userTexts(pane.messages), ['first']);
  await first;
  await sleep(60);
  assert.deepEqual(prompts, ['first', 'second']);
  assert.deepEqual(userTexts(pane.messages), ['first', 'second']);
  const drained = lastQueue(events);
  assert(drained?.type === 'queue' && drained.queue.length === 0);
});

test('a steer joins the running turn through the provider', async () => {
  const { assistant, pane } = scripted();
  const steered: string[] = [];
  assistant.script = async (_, turn) => {
    turn.setSteer(async ({ text }) => void steered.push(text));
    await sleep(30);
  };
  const turn = assistant.send(sendInput('first'));
  // The provider takes steers once it is running; before that they are queued (see below).
  await sleep(5);
  await assistant.send({ ...sendInput('also this'), followUp: 'steer' });
  await turn;
  assert.deepEqual(steered, ['also this']);
  assert.deepEqual(userTexts(pane.messages), ['first', 'also this']);
});

test('a steer the turn cannot take yet is queued instead', async () => {
  const { assistant, events } = scripted();
  assistant.script = () => sleep(30);
  const turn = assistant.send(sendInput('first'));
  await assistant.send({ ...sendInput('later'), followUp: 'steer' });
  const queued = lastQueue(events);
  assert(queued?.type === 'queue' && queued.queue[0].text === 'later');
  await turn;
});

test('the queue waits after a stop until a message is sent on purpose', async () => {
  const { assistant, events } = scripted();
  const prompts: string[] = [];
  assistant.script = (_, turn) => {
    prompts.push(turn.input.text);
    return new Promise((resolve) =>
      turn.controller.signal.addEventListener('abort', () => resolve()),
    );
  };
  const first = assistant.send(sendInput('first'));
  await assistant.send({ ...sendInput('second'), followUp: 'queue' });
  assistant.cancel('pane');
  await first;
  await sleep(20);
  assert.deepEqual(prompts, ['first']);
  const queued = lastQueue(events);
  assert(queued?.type === 'queue');
  assistant.script = async (_, turn) => void prompts.push(turn.input.text);
  await assistant.sendQueued('pane', queued.queue[0].id);
  assert.deepEqual(prompts, ['first', 'second']);
});

test('a queued message can be removed', async () => {
  const { assistant, events } = scripted();
  const prompts: string[] = [];
  assistant.script = async (_, turn) => {
    prompts.push(turn.input.text);
    await sleep(30);
  };
  const first = assistant.send(sendInput('first'));
  await assistant.send({ ...sendInput('second'), followUp: 'queue' });
  const queued = lastQueue(events);
  assert(queued?.type === 'queue');
  assistant.unqueue('pane', queued.queue[0].id);
  await first;
  await sleep(40);
  assert.deepEqual(prompts, ['first']);
  assert.equal(assistant.snapshot('pane').queue.length, 0);
});

/** The status events of whatever `script` does with a fresh assistant. */
async function statusesOf(
  script: (
    assistant: ReturnType<typeof scripted>['assistant'],
  ) => Promise<void>,
) {
  const { assistant, events } = scripted();
  await script(assistant);
  return events.flatMap((event) =>
    event.type === 'status' ? [event.status] : [],
  );
}

test('a turn reports completed only when it neither failed nor was stopped', async () => {
  assert.deepEqual(
    await statusesOf((assistant) => assistant.send(sendInput())),
    ['running', 'completed', 'idle'],
  );
  assert.deepEqual(
    await statusesOf(async (assistant) => {
      assistant.script = async () => {
        throw new Error('Boom');
      };
      await assistant.send(sendInput());
    }),
    ['running', 'failed', 'idle'],
  );
  assert.deepEqual(
    await statusesOf(async (assistant) => {
      assistant.script = (_, turn) =>
        new Promise((resolve) =>
          turn.controller.signal.addEventListener('abort', () => resolve()),
        );
      const turn = assistant.send(sendInput());
      assistant.cancel('pane');
      await turn;
    }),
    ['running', 'idle'],
  );
});

test('pasted text becomes an attachment without a preview', async () => {
  const { assistant, pane } = scripted();
  let attached = '';
  assistant.script = async (_, turn) => {
    const [attachment] = turn.attachments;
    if (attachment.kind === 'text') attached = attachment.text;
  };
  const { id, previewUrl, size } = assistant.attachText('pane', 'a'.repeat(6));
  assert.equal(previewUrl, undefined);
  assert.equal(size, 6);
  await assistant.send({ ...sendInput(), attachmentIds: [id] });
  assert.equal(attached, 'aaaaaa');
  const message = pane.messages.find((item) => item.kind === 'attachment');
  assert.equal(message?.text, 'Pasted text.txt');
});

test('generated text is trimmed', async () => {
  const { assistant } = scripted();
  assert.equal(await assistant.generate('  A title \n', 'model'), 'A title');
});

test('discarding a pane drops its queue', async () => {
  const { assistant } = scripted();
  assistant.script = (_, turn) =>
    new Promise((resolve) =>
      turn.controller.signal.addEventListener('abort', () => resolve()),
    );
  const turn = assistant.send(sendInput('first'));
  await assistant.send({ ...sendInput('second'), followUp: 'queue' });
  assistant.discard('pane');
  await turn;
  assert.equal(assistant.snapshot('pane').queue.length, 0);
});
