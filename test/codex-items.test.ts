import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  displayCommand,
  imagesFromItem,
  messageFromItem,
  planMessage,
} from '../electron/main/codex-items';
import type { ThreadItem } from '../electron/main/codex-protocol';

test('agent messages and reasoning map to text and thinking', () => {
  const text = messageFromItem(
    { type: 'agentMessage', id: 'a', text: 'Hello' },
    false,
  );
  assert.deepEqual(
    [text?.kind, text?.text, text?.status],
    ['text', 'Hello', 'streaming'],
  );
  const thinking = messageFromItem(
    { type: 'reasoning', id: 'r', summary: ['One', 'Two'], content: [] },
    true,
  );
  assert.deepEqual(
    [thinking?.kind, thinking?.text, thinking?.status],
    ['thinking', 'One\n\nTwo', 'complete'],
  );
});

test('user messages and unknown items are not shown', () => {
  assert.equal(
    messageFromItem({ type: 'userMessage', id: 'u' }, true),
    undefined,
  );
  assert.equal(
    messageFromItem(
      { type: 'somethingNew', id: 'x' } as unknown as ThreadItem,
      true,
    ),
    undefined,
  );
});

test('a command is a Bash tool that fails on a non-zero exit', () => {
  const command = (exitCode: number | null, completed: boolean) =>
    messageFromItem(
      {
        type: 'commandExecution',
        id: 'c',
        command: "/bin/zsh -lc 'npm test'",
        status: completed ? 'completed' : 'inProgress',
        aggregatedOutput: 'out',
        exitCode,
      },
      completed,
    );
  const running = command(null, false);
  assert.equal(running?.status, 'streaming');
  assert.deepEqual(running?.tool, {
    name: 'Bash',
    input: 'npm test',
    output: 'out',
  });
  assert.equal(command(0, true)?.status, 'complete');
  assert.equal(command(1, true)?.status, 'failed');
});

test('declined and failed items are failed', () => {
  const edit = (status: 'declined' | 'failed') =>
    messageFromItem(
      {
        type: 'fileChange',
        id: 'f',
        status,
        changes: [{ path: 'a.ts', kind: { type: 'update' }, diff: '+x' }],
      },
      true,
    );
  assert.equal(edit('declined')?.status, 'failed');
  assert.equal(edit('failed')?.status, 'failed');
});

test('file changes list the paths and show the diff', () => {
  const message = messageFromItem(
    {
      type: 'fileChange',
      id: 'f',
      status: 'completed',
      changes: [
        { path: 'a.ts', kind: { type: 'update' }, diff: '+one' },
        { path: 'b.ts', kind: { type: 'add' }, diff: '' },
      ],
    },
    true,
  );
  assert.equal(message?.tool?.name, 'Edit');
  assert.equal(message?.tool?.input, 'a.ts, b.ts');
  assert.equal(message?.tool?.output, 'update a.ts\n+one\n\nadd b.ts');
});

test('MCP tool calls show their arguments and result', () => {
  const message = messageFromItem(
    {
      type: 'mcpToolCall',
      id: 'm',
      server: 'docs',
      tool: 'search',
      status: 'completed',
      arguments: { query: 'svelte' },
      result: { content: [{ type: 'text', text: 'found it' }] },
      error: null,
    },
    true,
  );
  assert.deepEqual(message?.tool, {
    name: 'docs · search',
    input: 'svelte',
    output: 'found it',
  });
});

test('an MCP tool call surfaces its images, not just its text', () => {
  const item: ThreadItem = {
    type: 'mcpToolCall',
    id: 'm',
    server: 'browser',
    tool: 'screenshot',
    status: 'completed',
    arguments: {},
    result: {
      content: [
        { type: 'text', text: 'captured' },
        { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      ],
    },
    error: null,
  };
  assert.equal(messageFromItem(item, true)?.tool?.output, 'captured');
  assert.deepEqual(imagesFromItem(item), [
    { data: 'AAAA', mimeType: 'image/png' },
  ]);
});

test('a dynamic tool call without images has nothing to attach', () => {
  const item: ThreadItem = {
    type: 'dynamicToolCall',
    id: 'd',
    tool: 'lookup',
    status: 'completed',
    arguments: {},
    contentItems: [{ type: 'text', text: 'ok' }],
  };
  assert.deepEqual(imagesFromItem(item), []);
});

test('displayCommand strips the shell wrapper', () => {
  assert.equal(displayCommand("/bin/zsh -lc 'ls -la'"), 'ls -la');
  assert.equal(displayCommand("bash -lc 'echo '\\''hi'\\'''"), "echo 'hi'");
  assert.equal(displayCommand('ls'), 'ls');
});

test('plan steps become a to-do list that finishes when all are done', () => {
  const open = planMessage('t', [
    { step: 'Read', status: 'completed' },
    { step: 'Write', status: 'inProgress' },
  ]);
  assert.equal(open.tool?.output, '✓ Read\n→ Write');
  assert.equal(open.status, 'streaming');
  const done = planMessage('t', [{ step: 'Read', status: 'completed' }]);
  assert.equal(done.status, 'complete');
});
