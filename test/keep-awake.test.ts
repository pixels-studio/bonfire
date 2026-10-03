import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KeepAwake } from '../electron/main/keep-awake';
import { sleep } from './helpers';

function keepAwake({
  enabled = true,
  battery = undefined as number | undefined,
} = {}) {
  const held = new Set<number>();
  let next = 1;
  const settings = { enabled };
  const power = {
    start: () => {
      held.add(next);
      return next++;
    },
    stop: (blocker: number) => void held.delete(blocker),
    dischargingLevel: async () => battery,
  };
  const awake = new KeepAwake(() => settings.enabled, power);
  const status = (paneId: string, value: 'running' | 'idle') =>
    awake.handle({ paneId, type: 'status', status: value });
  return { awake, held, settings, status };
}

test('sleep is blocked while any turn runs', () => {
  const { held, status, awake } = keepAwake();
  status('a', 'running');
  status('b', 'running');
  assert.equal(held.size, 1);
  status('a', 'idle');
  assert.equal(held.size, 1);
  status('b', 'idle');
  assert.equal(held.size, 0);
  awake.close();
});

test('turning the setting off releases the block at once', () => {
  const { held, status, settings, awake } = keepAwake();
  status('a', 'running');
  settings.enabled = false;
  awake.update();
  assert.equal(held.size, 0);
  awake.close();
});

test('a nearly empty battery lets the system sleep', async () => {
  const { held, status, awake } = keepAwake({ battery: 9 });
  status('a', 'running');
  await sleep(10);
  assert.equal(held.size, 0);
  awake.close();
});

test('a battery above the floor keeps the block', async () => {
  const { held, status, awake } = keepAwake({ battery: 50 });
  status('a', 'running');
  await sleep(10);
  assert.equal(held.size, 1);
  awake.close();
});
