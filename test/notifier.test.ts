import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssistantEvent } from '../shared/contracts';
import { TurnNotifier, type Notice } from '../electron/main/notifier';
import { fakeStore } from './helpers';

test('streamed updates pass the notifier without reading settings or panes', () => {
  const { store } = fakeStore('claude');
  let reads = 0;
  Object.defineProperty(store, 'preferences', {
    get: () => {
      reads++;
      return { notifications: true };
    },
  });
  (store as { state: unknown }).state = {
    panes: [{ id: 'pane', type: 'claude', title: 'Chat', archived: false }],
  };
  const shown: Notice[] = [];
  const notifier = new TurnNotifier(store, (notice) => shown.push(notice));
  const delta: AssistantEvent = {
    paneId: 'pane',
    type: 'delta',
    id: 'message',
    field: 'text',
    text: 'hi',
  };
  for (let index = 0; index < 100; index++) notifier.handle(delta);
  assert.equal(reads, 0);
  notifier.handle({ paneId: 'pane', type: 'status', status: 'completed' });
  assert.deepEqual(shown, [
    { paneId: 'pane', title: 'Chat', body: 'Claude finished' },
  ]);
});
