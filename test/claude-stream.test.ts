import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssistantEvent } from '../shared/contracts';
import { ClaudeAssistant } from '../electron/main/claude';
import { fakeStore, host } from './helpers';

/** Streams a tool call's input JSON in `size`-character deltas; returns the inputs shown. */
function streamToolInput(name: string, json: string, size: number) {
  const { pane, store } = fakeStore('claude');
  const events: AssistantEvent[] = [];
  const assistant = new ClaudeAssistant(
    store,
    (event) => events.push(event),
    host,
  );
  const handle = (event: unknown) =>
    (assistant as unknown as { handle: Function }).handle(
      { pane },
      { type: 'stream_event', parent_tool_use_id: null, event },
      state,
    );
  const state = { current: '', blocks: new Map() };
  const shown: string[] = [];
  handle({ type: 'message_start', message: { id: 'm', usage: {} } });
  handle({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'tool_use', id: 'tool', name },
  });
  for (let at = 0; at < json.length; at += size) {
    handle({
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'input_json_delta',
        partial_json: json.slice(at, at + size),
      },
    });
    const input = pane.messages.at(-1)?.tool?.input ?? '';
    if (input !== shown.at(-1)) shown.push(input);
  }
  assistant.close();
  return shown;
}

test('a short tool input shows as soon as its key argument arrives', () => {
  const shown = streamToolInput('Bash', '{"command":"ls -la"}', 1);
  assert.equal(shown.at(-1), 'ls -la');
  // It grew with the stream rather than appearing only at the end.
  assert.ok(shown.includes('ls'));
});

test('a long tool input still shows its key argument while it streams', () => {
  const content = 'x'.repeat(50_000);
  const json = JSON.stringify({ file_path: '/src/app.ts', content });
  const shown = streamToolInput('Write', json, 3);
  assert.equal(shown.at(-1), '/src/app.ts');
});
