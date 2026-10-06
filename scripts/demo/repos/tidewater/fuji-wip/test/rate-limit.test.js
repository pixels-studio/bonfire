import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRateLimiter } from '../src/rate-limit.js';

test('a client can burst, then is refused', () => {
  let time = 0;
  const take = createRateLimiter({ perMinute: 60, burst: 3, now: () => time });
  assert.equal(take('a').allowed, true);
  assert.equal(take('a').allowed, true);
  assert.equal(take('a').allowed, true);
  const refused = take('a');
  assert.equal(refused.allowed, false);
  assert.equal(refused.retryAfterSeconds, 1);
});

test('tokens refill over time', () => {
  let time = 0;
  const take = createRateLimiter({ perMinute: 60, burst: 1, now: () => time });
  take('a');
  assert.equal(take('a').allowed, false);
  time += 1000;
  assert.equal(take('a').allowed, true);
});

test('clients have separate buckets', () => {
  const take = createRateLimiter({ perMinute: 60, burst: 1 });
  take('a');
  assert.equal(take('b').allowed, true);
});
