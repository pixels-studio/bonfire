import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BUSY_CHARS_PER_SECOND,
  IDLE_AFTER_MS,
  OutputActivity,
  WebglPool,
  WEBGL_LIMIT,
} from '../src/lib/webgl-pool';
import { MAX_TERMINAL_PANES } from '../shared/domain';

function claim(log: string[], name: string) {
  return {
    grant: () => log.push(`grant ${name}`),
    revoke: () => log.push(`revoke ${name}`),
  };
}

test('the page keeps one WebGL context spare, and every terminal pane can have one', () => {
  assert.equal(WEBGL_LIMIT, 15);
  assert.equal(MAX_TERMINAL_PANES, WEBGL_LIMIT);
});

test('terminals past the limit wait, and the first waiting gets the context let go', () => {
  const log: string[] = [];
  const pool = new WebglPool(2);
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((name) => claim(log, name));
  pool.want(a);
  pool.want(b);
  pool.want(c);
  pool.want(d);
  pool.want(a);
  assert.deepEqual(log, ['grant a', 'grant b']);
  pool.release(a);
  assert.deepEqual(log.slice(2), ['revoke a', 'grant c']);
  // One that stops waiting is passed over.
  pool.release(d);
  pool.release(b);
  assert.deepEqual(log.slice(4), ['revoke b']);
  assert.equal(pool.size, 1);
});

test('a lost context frees its place without being revoked', () => {
  const log: string[] = [];
  const pool = new WebglPool(1);
  const [a, b] = ['a', 'b'].map((name) => claim(log, name));
  pool.want(a);
  pool.want(b);
  pool.lost(a);
  assert.deepEqual(log, ['grant a', 'grant b']);
});

test('once WebGL fails to start, every terminal draws without it', () => {
  const log: string[] = [];
  const pool = new WebglPool(2);
  const [a, b, c] = ['a', 'b', 'c'].map((name) => claim(log, name));
  pool.want(a);
  pool.disable();
  pool.want(b);
  pool.release(c);
  assert.deepEqual(log, ['grant a', 'revoke a']);
  assert.equal(pool.size, 0);
});

test('a terminal is busy from a second of heavy output until it has been quiet a while', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0;
  const changes: boolean[] = [];
  const activity = new OutputActivity(
    (busy) => changes.push(busy),
    () => now,
  );
  // Typing and short commands never make it busy.
  for (let i = 0; i < 100; i++) activity.output(100);
  assert.deepEqual(changes, []);
  now = 1000;
  activity.output(BUSY_CHARS_PER_SECOND);
  assert.deepEqual(changes, [true]);
  // More heavy output keeps it busy rather than starting it again.
  now = 2000;
  t.mock.timers.tick(5000);
  activity.output(BUSY_CHARS_PER_SECOND);
  t.mock.timers.tick(IDLE_AFTER_MS - 1);
  assert.equal(activity.isBusy, true);
  t.mock.timers.tick(1);
  assert.deepEqual(changes, [true, false]);
  activity.close();
});
