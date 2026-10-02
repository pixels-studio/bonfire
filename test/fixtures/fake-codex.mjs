// A stand-in for `codex app-server` that follows the protocol shapes seen from the real one.
// The prompt text picks the scenario.
import { createInterface } from 'node:readline';

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const notify = (method, params) => write({ method, params });
let nextRequest = 100;
const waiting = new Map();
const ask = (method, params) =>
  new Promise((resolve) => {
    const id = nextRequest++;
    waiting.set(id, resolve);
    write({ id, method, params });
  });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const interrupted = new Map();

const usage = (threadId, turnId) =>
  notify('thread/tokenUsage/updated', {
    threadId,
    turnId,
    tokenUsage: {
      total: {},
      last: {
        totalTokens: 1100,
        inputTokens: 1000,
        cachedInputTokens: 600,
        outputTokens: 100,
        reasoningOutputTokens: 40,
      },
      modelContextWindow: 258000,
    },
  });
const complete = (threadId, turnId, status = 'completed', error = null) =>
  notify('turn/completed', {
    threadId,
    turn: { id: turnId, items: [], status, error },
  });

async function runTurn(threadId, turnId, text) {
  notify('turn/started', {
    threadId,
    turn: { id: turnId, status: 'inProgress' },
  });
  const item = (id, fields) => ({ id, ...fields });
  if (text.startsWith('hello')) {
    notify('item/started', {
      threadId,
      turnId,
      item: item('r1', { type: 'reasoning', summary: [], content: [] }),
    });
    notify('item/reasoning/summaryTextDelta', {
      threadId,
      turnId,
      itemId: 'r1',
      delta: 'Think',
      summaryIndex: 0,
    });
    notify('item/reasoning/summaryTextDelta', {
      threadId,
      turnId,
      itemId: 'r1',
      delta: 'Next',
      summaryIndex: 1,
    });
    notify('item/completed', {
      threadId,
      turnId,
      item: item('r1', {
        type: 'reasoning',
        summary: ['Think', 'Next'],
        content: [],
      }),
    });
    notify('item/started', {
      threadId,
      turnId,
      item: item('a1', { type: 'agentMessage', text: '' }),
    });
    for (const delta of ['Hel', 'lo', '!']) {
      notify('item/agentMessage/delta', {
        threadId,
        turnId,
        itemId: 'a1',
        delta,
      });
      await sleep(35);
    }
    notify('item/completed', {
      threadId,
      turnId,
      item: item('a1', { type: 'agentMessage', text: 'Hello!' }),
    });
    usage(threadId, turnId);
    complete(threadId, turnId);
  } else if (text.startsWith('approve')) {
    const command = {
      type: 'commandExecution',
      command: "/bin/zsh -lc 'touch x'",
      status: 'inProgress',
      aggregatedOutput: null,
      exitCode: null,
    };
    notify('item/started', { threadId, turnId, item: item('c1', command) });
    const answer = await ask('item/commandExecution/requestApproval', {
      kind: 'command',
      threadId,
      turnId,
      itemId: 'c1',
      command: "/bin/zsh -lc 'touch x'",
      reason: 'Needs write access',
    });
    const done =
      answer.decision === 'accept' || answer.decision === 'acceptForSession';
    notify('item/completed', {
      threadId,
      turnId,
      item: item('c1', {
        ...command,
        status: done ? 'completed' : 'declined',
        aggregatedOutput: '',
        exitCode: done ? 0 : null,
      }),
    });
    notify('item/started', {
      threadId,
      turnId,
      item: item('a1', { type: 'agentMessage', text: '' }),
    });
    notify('item/completed', {
      threadId,
      turnId,
      item: item('a1', {
        type: 'agentMessage',
        text: `decision:${answer.decision}`,
      }),
    });
    complete(threadId, turnId);
  } else if (text.startsWith('ask')) {
    const answer = await ask('item/tool/requestUserInput', {
      threadId,
      turnId,
      itemId: 'q1',
      isBlocking: true,
      autoResolutionMs: null,
      questions: [
        {
          id: 'which',
          header: 'Which',
          question: 'Which one?',
          isOther: true,
          isSecret: false,
          options: [{ label: 'A', description: 'first' }],
        },
      ],
    });
    notify('item/started', {
      threadId,
      turnId,
      item: item('a1', { type: 'agentMessage', text: '' }),
    });
    notify('item/completed', {
      threadId,
      turnId,
      item: item('a1', {
        type: 'agentMessage',
        text: `answers:${JSON.stringify(answer.answers)}`,
      }),
    });
    complete(threadId, turnId);
  } else if (text.startsWith('stream')) {
    notify('item/started', {
      threadId,
      turnId,
      item: item('c1', {
        type: 'commandExecution',
        command: 'ls',
        status: 'inProgress',
        aggregatedOutput: null,
        exitCode: null,
      }),
    });
    notify('item/commandExecution/outputDelta', {
      threadId,
      turnId,
      itemId: 'c1',
      delta: 'one\n',
    });
    await sleep(40);
    notify('item/commandExecution/outputDelta', {
      threadId,
      turnId,
      itemId: 'c1',
      delta: 'two\n',
    });
    await sleep(40);
    notify('item/completed', {
      threadId,
      turnId,
      item: item('c1', {
        type: 'commandExecution',
        command: 'ls',
        status: 'completed',
        aggregatedOutput: 'one\ntwo\n',
        exitCode: 0,
      }),
    });
    complete(threadId, turnId);
  } else if (text.startsWith('hang')) {
    notify('item/started', {
      threadId,
      turnId,
      item: item('a1', { type: 'agentMessage', text: '' }),
    });
    notify('item/agentMessage/delta', {
      threadId,
      turnId,
      itemId: 'a1',
      delta: 'working',
    });
    await new Promise((resolve) => interrupted.set(turnId, resolve));
    complete(threadId, turnId, 'interrupted');
  } else if (text.startsWith('fail')) {
    const message = JSON.stringify({
      type: 'error',
      status: 400,
      error: { message: 'Model not supported' },
    });
    notify('error', { threadId, turnId, willRetry: false, error: { message } });
    complete(threadId, turnId, 'failed', { message });
  } else if (text.startsWith('retry')) {
    notify('error', {
      threadId,
      turnId,
      willRetry: true,
      error: { message: 'Reconnecting' },
    });
    notify('item/started', {
      threadId,
      turnId,
      item: item('a1', { type: 'agentMessage', text: '' }),
    });
    notify('item/completed', {
      threadId,
      turnId,
      item: item('a1', { type: 'agentMessage', text: 'ok' }),
    });
    complete(threadId, turnId);
  } else if (text.startsWith('crash')) {
    process.exit(3);
  }
}

let counter = 0;
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  const { id, method, params } = message;
  if (method === undefined)
    return (void waiting.get(id)?.(message.result), waiting.delete(id));
  const reply = (result) => write({ id, result });
  switch (method) {
    case 'initialize':
      return reply({
        userAgent: 'fake',
        codexHome: '/tmp',
        platformFamily: 'unix',
        platformOs: 'macos',
      });
    case 'initialized':
      return;
    case 'model/list':
      return reply({
        data: [
          { model: 'fake-1', displayName: 'Fake 1', hidden: false },
          { model: 'fake-hidden', displayName: 'Hidden', hidden: true },
        ],
        nextCursor: null,
      });
    case 'thread/start':
      return reply({
        thread: { id: `thread-${++counter}` },
        model: params.model,
        settings: params,
      });
    case 'thread/resume':
      return reply({ thread: { id: params.threadId } });
    case 'turn/start': {
      const turnId = `turn-${++counter}`;
      reply({ turn: { id: turnId, status: 'inProgress' } });
      void runTurn(params.threadId, turnId, params.input[0].text);
      return;
    }
    case 'turn/interrupt':
      interrupted.get(params.turnId)?.();
      return reply({});
    default:
      return write({
        id,
        error: { code: -32601, message: `unknown ${method}` },
      });
  }
});
