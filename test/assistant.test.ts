import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SessionNotFound, assistantMessage } from '../electron/main/assistant';
import { sessionNotFound, skillText } from '../electron/main/claude';
import { threadNotFound } from '../electron/main/codex';
import { CodexRpcError } from '../electron/main/codex-rpc';
import { promptParts, promptText, withoutMarkers } from '../shared/domain';
import { scripted, sendInput, sleep } from './helpers';

const streaming = (id: string, text = '') =>
  assistantMessage(id, 'text', text, 'streaming');

test('streamed text goes out as batched deltas after the first message', async () => {
  const { assistant, pane, events } = scripted();
  assistant.script = async ({ tools }) => {
    tools.publish(pane, streaming('m'), false);
    await sleep(40); // the first message is flushed on its own
    tools.append(pane, 'm', 'text', 'Hel');
    tools.append(pane, 'm', 'text', 'lo');
    await sleep(40);
    tools.append(pane, 'm', 'text', '!');
    await sleep(40);
    tools.publish(pane, assistantMessage('m', 'text', 'Hello!'));
  };
  await assistant.send(sendInput());

  const shape = events.map((event) =>
    event.type === 'delta'
      ? `delta:${event.text}`
      : event.type === 'message'
        ? `message:${event.message.status}:${event.message.role}`
        : event.type === 'status'
          ? `status:${event.status}`
          : event.type,
  );
  assert.deepEqual(shape, [
    'message:complete:user',
    'status:running',
    'message:streaming:assistant',
    'delta:Hello',
    'delta:!',
    'message:complete:assistant',
    'status:completed',
    'status:idle',
  ]);
  assert.equal(pane.messages.at(-1)?.text, 'Hello!');
});

test('a pending delta is sent before a later event so order holds', async () => {
  const { assistant, pane, events } = scripted();
  assistant.script = async ({ tools }) => {
    tools.publish(pane, streaming('m'), false);
    await sleep(40);
    tools.append(pane, 'm', 'text', 'abc');
    tools.publishUsage(pane, {
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1,
      reasoningOutputTokens: 0,
    });
  };
  await assistant.send(sendInput());
  const types = events.map((event) => event.type);
  assert(types.indexOf('delta') < types.indexOf('usage'));
});

test('tool output streams as output deltas and stops at the cap', async () => {
  const { assistant, pane, events } = scripted();
  assistant.script = async ({ tools }) => {
    tools.publish(
      pane,
      {
        ...assistantMessage('t', 'tool', 'Bash ls', 'streaming'),
        tool: { name: 'Bash', input: 'ls', output: '' },
      },
      false,
    );
    await sleep(40);
    tools.append(pane, 't', 'output', 'a\n');
    await sleep(40);
    tools.append(pane, 't', 'output', 'x'.repeat(30_000));
    await sleep(40);
    tools.append(pane, 't', 'output', 'dropped');
    await sleep(40);
  };
  await assistant.send(sendInput());
  const deltas = events.filter((event) => event.type === 'delta');
  assert.equal(deltas.length, 2);
  assert.equal(deltas[0].type === 'delta' && deltas[0].field, 'output');
  assert(!pane.messages.some((item) => item.tool?.output.includes('dropped')));
});

test('a message that changes more than its text is sent whole', async () => {
  const { assistant, pane, events } = scripted();
  assistant.script = async ({ tools }) => {
    const tool = {
      ...assistantMessage('t', 'tool', 'Bash', 'streaming'),
      tool: { name: 'Bash', input: '', output: '' },
    };
    tools.publish(pane, tool, false);
    await sleep(40);
    tools.publish(
      pane,
      { ...tool, tool: { ...tool.tool, input: 'ls' } },
      false,
    );
    await sleep(40);
  };
  await assistant.send(sendInput());
  assert.equal(events.filter((event) => event.type === 'delta').length, 0);
  assert.equal(
    events.filter(
      (event) => event.type === 'message' && event.message.id === 't',
    ).length,
    3, // two updates plus the settled copy when the turn ends
  );
});

test('cancel interrupts gracefully and leaves nothing shimmering or reported', async () => {
  const { assistant, pane, events } = scripted();
  let interrupted = false;
  assistant.script = async ({ tools }, turn) => {
    tools.publish(pane, streaming('m', 'partial'), false);
    tools.publish(
      pane,
      {
        ...assistantMessage('t', 'tool', 'Bash', 'streaming'),
        tool: { name: 'Bash', input: 'sleep 9', output: '' },
      },
      false,
    );
    await new Promise<void>((resolve) =>
      turn.setInterrupt(async () => {
        interrupted = true;
        setTimeout(resolve, 10);
      }),
    );
  };
  const done = assistant.send(sendInput());
  await sleep(40);
  assistant.cancel('pane');
  await done;
  assert(interrupted);
  assert(pane.messages.every((item) => item.status !== 'streaming'));
  assert(!pane.messages.some((item) => item.kind === 'error'));
  assert(
    !events.some(
      (event) => event.type === 'status' && event.status === 'failed',
    ),
  );
  assert.deepEqual(events.at(-1), {
    paneId: 'pane',
    type: 'status',
    status: 'idle',
  });
});

test('cancel without an interrupt aborts the turn', async () => {
  const { assistant, pane } = scripted();
  assistant.script = (_, turn) =>
    new Promise((_, reject) =>
      turn.controller.signal.addEventListener('abort', () =>
        reject(new Error('aborted')),
      ),
    );
  const done = assistant.send(sendInput());
  await sleep(20);
  assistant.cancel('pane');
  await done;
  assert(!pane.messages.some((item) => item.kind === 'error'));
});

test('an interrupt that never lands is escalated to an abort', async () => {
  const { assistant } = scripted();
  const originalSetTimeout = globalThis.setTimeout;
  // Shortens the grace period so the test doesn't wait seconds.
  globalThis.setTimeout = ((fn: () => void, ms?: number, ...args: unknown[]) =>
    originalSetTimeout(
      fn,
      ms === 5_000 ? 30 : ms,
      ...args,
    )) as typeof setTimeout;
  try {
    assistant.script = (_, turn) =>
      new Promise((resolve) => {
        turn.setInterrupt(() => new Promise(() => {})); // never resolves
        turn.controller.signal.addEventListener('abort', () => resolve());
      });
    const done = assistant.send(sendInput());
    await sleep(20);
    assistant.cancel('pane');
    await done;
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('an error is shown once even if it is also thrown', async () => {
  const { assistant, pane, events } = scripted();
  assistant.script = async ({ tools }) => {
    tools.publishError(pane, 'Boom');
    throw new Error('Boom again');
  };
  await assistant.send(sendInput());
  const errors = pane.messages.filter((item) => item.kind === 'error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].text, 'Boom');
  assert(
    events.some(
      (event) => event.type === 'status' && event.status === 'failed',
    ),
  );
});

test('a thrown error is reported when nothing else was', async () => {
  const { assistant, pane } = scripted();
  assistant.script = async () => {
    throw new Error('Crash');
  };
  await assistant.send(sendInput());
  assert.equal(
    pane.messages.filter((item) => item.kind === 'error')[0].text,
    'Crash',
  );
});

test('a failed turn marks unfinished tools failed', async () => {
  const { assistant, pane } = scripted();
  assistant.script = async ({ tools }) => {
    tools.publish(
      pane,
      {
        ...assistantMessage('t', 'tool', 'Bash', 'streaming'),
        tool: { name: 'Bash', input: '', output: '' },
      },
      false,
    );
    throw new Error('Crash');
  };
  await assistant.send(sendInput());
  assert.equal(pane.messages.find((item) => item.id === 't')?.status, 'failed');
});

test('requests wait for the user and are removed once answered', async () => {
  const { assistant, pane, events } = scripted();
  let answer: unknown;
  assistant.script = async ({ tools }) => {
    answer = await tools.ask(pane, {
      kind: 'approval',
      title: 'Run',
      detail: 'ls',
      canRemember: false,
    });
  };
  const done = assistant.send(sendInput());
  await sleep(20);
  const request = events.find((event) => event.type === 'request');
  assert(request && request.type === 'request');
  assert.deepEqual(
    (await assistant.snapshot('pane')).requests.map(({ id }) => id),
    [request.request.id],
  );
  assistant.respond({
    paneId: 'pane',
    requestId: request.request.id,
    decision: 'allow-session',
  });
  await done;
  assert.deepEqual(answer, { decision: 'allow-session' });
  assert(events.some((event) => event.type === 'request-resolved'));
  assert.equal((await assistant.snapshot('pane')).requests.length, 0);
});

test('a response for another pane or an old request is ignored', async () => {
  const { assistant } = scripted();
  assistant.respond({ paneId: 'pane', requestId: 'gone', decision: 'allow' });
});

test('cancelling resolves pending requests as refused', async () => {
  const { assistant, pane, events } = scripted();
  let answer: unknown = 'unset';
  assistant.script = async ({ tools }) => {
    answer = await tools.ask(pane, {
      kind: 'question',
      questions: [],
    });
  };
  const done = assistant.send(sendInput());
  await sleep(20);
  assistant.cancel('pane');
  await done;
  assert.equal(answer, undefined);
  assert(events.some((event) => event.type === 'request-resolved'));
});

test('a second send during a turn is rejected', async () => {
  const { assistant } = scripted();
  assistant.script = () => sleep(50);
  const first = assistant.send(sendInput());
  await assert.rejects(
    assistant.send(sendInput('again')),
    /already responding/,
  );
  await first;
});

test('a snapshot reports a running turn and does not repeat batched text', async () => {
  const { assistant, pane, events } = scripted();
  let snapshot: Awaited<ReturnType<typeof assistant.snapshot>> | undefined;
  assistant.script = async ({ tools }) => {
    tools.publish(pane, streaming('m'), false);
    await sleep(40);
    tools.append(pane, 'm', 'text', 'abc');
    snapshot = assistant.snapshot('pane');
    await sleep(40);
  };
  await assistant.send(sendInput());
  assert(snapshot?.running);
  assert.equal(snapshot?.messages.find((item) => item.id === 'm')?.text, 'abc');
  // The batched delta went out before the snapshot was taken, not after it.
  assert.equal(events.filter((event) => event.type === 'delta').length, 1);
});

test('model lists are cached and a failed refresh serves the stale list', async () => {
  const { assistant } = scripted();
  let calls = 0;
  let fail = false;
  (assistant as unknown as { listModels: () => Promise<unknown> }).listModels =
    async () => {
      calls++;
      if (fail) throw new Error('offline');
      return [{ value: 'a', label: 'A' }];
    };
  await assistant.models();
  await assistant.models();
  assert.equal(calls, 1);
  fail = true;
  const clock = Date.now;
  Date.now = () => clock() + 120_000;
  try {
    assert.deepEqual(await assistant.models(), [{ value: 'a', label: 'A' }]);
  } finally {
    Date.now = clock;
  }
  assert.equal(calls, 2);
});

test('fast mode is kept for a model that supports it and dropped for one that does not', async () => {
  for (const [model, expected] of [
    ['a', true],
    ['b', false],
    ['unlisted', false],
  ] as const) {
    const { assistant, pane } = scripted();
    let ran: boolean | undefined;
    assistant.script = async (_, turn) => {
      ran = turn.input.fastMode;
    };
    await assistant.send({ ...sendInput(), model, fastMode: true });
    assert.equal(ran, expected, model);
    assert.equal(pane.fastMode, expected, model);
  }
});

test('attached skills reach the provider and show as /name in the conversation', async () => {
  const { assistant, pane, events } = scripted();
  let skills: string[] = [];
  assistant.script = async (_, turn) => {
    skills = turn.skills.map(({ name }) => name);
  };
  await assistant.send({ ...sendInput('the auth module'), skills: ['review'] });
  assert.deepEqual(skills, ['review']);
  const prompt = pane.messages.find((item) => item.role === 'user');
  assert.equal(prompt?.text, '/review the auth module');
  assert(events.some((event) => event.type === 'message'));
});

test('a skill can be sent without any text', async () => {
  const { assistant, pane } = scripted();
  await assistant.send({ ...sendInput(''), skills: ['review'] });
  assert.equal(pane.messages[0]?.text, '/review');
});

test('a skill the provider no longer offers is refused before the turn starts', async () => {
  const { assistant, pane } = scripted();
  let ran = false;
  assistant.script = async () => void (ran = true);
  await assert.rejects(
    assistant.send({ ...sendInput('x'), skills: ['gone'] }),
    /\/gone skill is no longer available/,
  );
  assert.equal(ran, false);
  assert.equal(pane.messages.length, 0);
});

test('a queued follow-up keeps its skills', async () => {
  const { assistant } = scripted();
  const seen: string[][] = [];
  let release!: () => void;
  assistant.script = async (_, turn) => {
    seen.push(turn.skills.map(({ name }) => name));
    if (seen.length === 1) await new Promise<void>((r) => (release = r));
  };
  const first = assistant.send(sendInput('first'));
  await sleep(10);
  await assistant.send({
    ...sendInput('next'),
    skills: ['review'],
    followUp: 'queue',
  });
  assert.equal(assistant.snapshot('pane').queue[0]?.text, '/review next');
  release();
  await first;
  await sleep(20);
  assert.deepEqual(seen, [[], ['review']]);
});

test('Claude runs the first skill as a command and is told about the rest', () => {
  assert.equal(skillText('fix it', []), 'fix it');
  assert.equal(skillText('fix it', [{ name: 'a' }]), '/a fix it');
  assert.equal(skillText('', [{ name: 'a' }]), '/a');
  assert.equal(
    skillText('fix it', [{ name: 'a' }, { name: 'b' }, { name: 'c' }]),
    '/a fix it Also use the /b, /c skills.',
  );
});

test('skills placed in the text are sent as /name, with the first still leading', () => {
  assert.equal(
    skillText('use [[skill:a]] on this', [{ name: 'a' }]),
    '/a use /a on this',
  );
  assert.equal(skillText('[[skill:a]] on this', [{ name: 'a' }]), '/a on this');
  assert.equal(skillText('[[skill:ab]] x', [{ name: 'a' }]), '/a /ab x');
});

test('a prompt shows its skills where they were typed', () => {
  assert.equal(
    promptText('use [[skill:a]] on this', ['a', 'b']),
    '/b use [[skill:a]] on this',
  );
  assert.equal(
    withoutMarkers('use [[skill:a]] on [[attachment:x-1]] now'),
    'use /a on now',
  );
  assert.deepEqual(promptParts('use [[skill:p:a]] on [[attachment:x]]'), [
    { text: 'use ' },
    { skill: 'p:a' },
    { text: ' on ' },
    { attachmentId: 'x' },
  ]);
});

test('a turn whose session is gone runs again in a new one, after a notice', async () => {
  const { assistant, pane, events } = scripted();
  pane.threadId = 'old';
  const resumed: (string | undefined)[] = [];
  assistant.script = async ({ tools }, turn) => {
    resumed.push(turn.pane.threadId);
    if (turn.pane.threadId) throw new SessionNotFound(turn.pane.threadId);
    tools.publish(pane, assistantMessage('reply', 'text', 'Hello'));
  };
  await assistant.send(sendInput());

  assert.deepEqual(resumed, ['old', undefined]);
  assert.equal(pane.threadId, undefined);
  assert.deepEqual(
    pane.messages.map(({ role, kind }) => `${role}:${kind}`),
    ['user:text', 'assistant:notice', 'assistant:text'],
  );
  assert.match(pane.messages[1].text, /no longer has the earlier session/);
  // The turn succeeded: no error shows and it finishes as completed.
  assert(!pane.messages.some(({ kind }) => kind === 'error'));
  assert(
    events.some(
      (event) => event.type === 'status' && event.status === 'completed',
    ),
  );
});

test('a session that is gone again in the new one is a plain failure, not a loop', async () => {
  const { assistant, pane } = scripted();
  pane.threadId = 'old';
  let runs = 0;
  assistant.script = async () => {
    runs++;
    throw new SessionNotFound('any');
  };
  await assistant.send(sendInput());
  assert.equal(runs, 2);
  assert.equal(pane.messages.at(-1)?.kind, 'error');
});

test('a missing session is told apart from other failures, for each CLI', () => {
  const id = '00000000-0000-4000-8000-000000000000';
  // As the Claude CLI reports it.
  const missing = {
    type: 'result',
    subtype: 'error_during_execution',
    num_turns: 0,
    errors: [`No conversation found with session ID: ${id}`],
  } as never;
  assert.equal(sessionNotFound(missing, id), true);
  assert.equal(sessionNotFound(missing, 'another'), false);
  assert.equal(
    sessionNotFound({ ...(missing as object), num_turns: 1 } as never, id),
    false,
  );
  assert.equal(
    sessionNotFound(
      { ...(missing as object), errors: ['Request timed out'] } as never,
      id,
    ),
    false,
  );

  // As `codex app-server` answers `thread/resume`.
  const gone = new CodexRpcError(
    -32600,
    `no rollout found for thread id ${id}`,
  );
  assert.equal(threadNotFound(gone, id), true);
  assert.equal(threadNotFound(gone, 'another'), false);
  assert.equal(
    threadNotFound(new CodexRpcError(-32600, 'thread is busy'), id),
    false,
  );
  assert.equal(threadNotFound(Error(gone.message), id), false);
});
