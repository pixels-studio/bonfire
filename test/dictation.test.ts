import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { API, DictationEvent } from '../shared/contracts';
import { dictationErrorMessage, startDictation } from '../src/lib/dictation';

function fakeApi({ early = [] as DictationEvent[] } = {}) {
  const listeners = new Set<(event: DictationEvent) => void>();
  const stopped: string[] = [];
  const api: API['dictation'] = {
    available: async () => true,
    start: async () => {
      for (const event of early)
        listeners.forEach((listener) => listener(event));
      return 'session-1';
    },
    stop: async (session) => void stopped.push(session),
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const emit = (event: DictationEvent) =>
    listeners.forEach((listener) => listener(event));
  return { api, emit, stopped, listeners };
}

test('relays the session’s text and level, and ignores other sessions', async () => {
  const { api, emit } = fakeApi();
  const texts: string[] = [];
  const levels: number[] = [];
  await startDictation({
    api,
    onText: (text) => texts.push(text),
    onLevel: (level) => levels.push(level),
  });
  emit({ session: 'session-1', type: 'result', text: 'hello' });
  emit({ session: 'other', type: 'result', text: 'stale' });
  emit({ session: 'session-1', type: 'result', text: 'hello world' });
  emit({ session: 'session-1', type: 'level', level: 0.5 });
  assert.deepEqual(texts, ['hello', 'hello world']);
  assert.deepEqual(levels, [0.5]);
});

test('handles events that arrive before start resolves', async () => {
  const { api } = fakeApi({
    early: [
      { session: 'session-1', type: 'error', error: 'not-allowed' },
      { session: 'session-1', type: 'end' },
    ],
  });
  const errors: string[] = [];
  let ended = false;
  await startDictation({
    api,
    onError: (error) => errors.push(error),
    onEnd: () => (ended = true),
  });
  assert.deepEqual(errors, ['not-allowed']);
  assert.equal(ended, true);
});

test('stop asks the helper to stop, and end unsubscribes', async () => {
  const { api, emit, stopped, listeners } = fakeApi();
  let ended = 0;
  const session = await startDictation({ api, onEnd: () => (ended += 1) });
  session.stop();
  assert.deepEqual(stopped, ['session-1']);
  emit({ session: 'session-1', type: 'end' });
  emit({ session: 'session-1', type: 'end' });
  assert.equal(ended, 1);
  assert.equal(listeners.size, 0);
  session.stop();
  assert.deepEqual(stopped, ['session-1']);
});

test('unsubscribes when start fails', async () => {
  const { api, listeners } = fakeApi();
  api.start = async () => {
    throw Error('Dictation is unavailable.');
  };
  await assert.rejects(startDictation({ api }));
  assert.equal(listeners.size, 0);
});

test('maps permission and capture errors to composer copy', () => {
  assert.match(dictationErrorMessage('not-allowed'), /Microphone access/);
  assert.match(
    dictationErrorMessage('service-not-allowed'),
    /Speech recognition/,
  );
  assert.equal(
    dictationErrorMessage('audio-capture'),
    'No microphone was found.',
  );
  assert.equal(
    dictationErrorMessage('unavailable'),
    'Dictation could not start.',
  );
});
