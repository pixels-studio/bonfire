import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Dispatcher } from '../src/lib/main-events';

type Event = { id: string; n: number };

function channel() {
  const state = { subscriptions: 0, emit: (_event: Event) => {} };
  const dispatcher = new Dispatcher<Event>(
    (listener) => {
      state.subscriptions++;
      state.emit = listener;
      return () => {
        state.subscriptions--;
        state.emit = () => {};
      };
    },
    (event) => event.id,
  );
  return { state, dispatcher };
}

test('every listener shares one subscription and hears only its own key', () => {
  const { state, dispatcher } = channel();
  const heard: string[] = [];
  const stops = [
    dispatcher.on('a', (event) => heard.push(`a${event.n}`)),
    dispatcher.on('b', (event) => heard.push(`b${event.n}`)),
    dispatcher.onAll((event) => heard.push(`all:${event.id}${event.n}`)),
  ];
  assert.equal(state.subscriptions, 1);
  state.emit({ id: 'a', n: 1 });
  state.emit({ id: 'c', n: 2 });
  assert.deepEqual(heard, ['all:a1', 'a1', 'all:c2']);
  for (const stop of stops) stop();
  assert.equal(state.subscriptions, 0);
});

test('stopping one listener leaves the others, even for the same function and key', () => {
  const { state, dispatcher } = channel();
  let count = 0;
  const listener = () => count++;
  const first = dispatcher.on('a', listener);
  const second = dispatcher.on('a', listener);
  first();
  first();
  state.emit({ id: 'a', n: 1 });
  assert.equal(count, 1);
  second();
  assert.equal(state.subscriptions, 0);
  // Listening again subscribes again.
  dispatcher.on('a', listener);
  assert.equal(state.subscriptions, 1);
});

test('a listener that stops itself mid-dispatch doesn’t skip the next', () => {
  const { state, dispatcher } = channel();
  const heard: string[] = [];
  const stop = dispatcher.on('a', () => {
    heard.push('first');
    stop();
  });
  dispatcher.on('a', () => heard.push('second'));
  state.emit({ id: 'a', n: 1 });
  state.emit({ id: 'a', n: 2 });
  assert.deepEqual(heard, ['first', 'second', 'second']);
});
