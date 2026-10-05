import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Rpc } from '../electron/main/rpc';
import { pair } from './helpers';

test('calls resolve with what the other side returns, or reject with its error', async () => {
  const [near, far] = pair();
  new Rpc(far, {
    add: (a: number, b: number) => a + b,
    later: async (text: string) => text.toUpperCase(),
    fail: () => {
      throw Error('No such terminal');
    },
  });
  const rpc = new Rpc<{
    add(a: number, b: number): number;
    later(text: string): Promise<string>;
    fail(): void;
    missing(): void;
  }>(near);
  assert.equal(await rpc.call('add', 2, 3), 5);
  assert.equal(await rpc.call('later', 'hi'), 'HI');
  await assert.rejects(rpc.call('fail'), /No such terminal/);
  await assert.rejects(rpc.call('missing'), /Unknown method missing/);
});

test('events sent before a reply are handled before the call resolves', async () => {
  const [near, far] = pair();
  const farSide: Rpc = new Rpc(far, {
    snapshot: () => {
      farSide.emit('delta', 'a');
      farSide.emit('delta', 'b');
      return 'done';
    },
  });
  const seen: string[] = [];
  const rpc = new Rpc(near).on<string>('delta', (text) => seen.push(text));
  assert.equal(await rpc.call('snapshot'), 'done');
  assert.deepEqual(seen, ['a', 'b']);
});

test('a channel that fails rejects calls waiting and calls made after', async () => {
  const [near] = pair();
  const rpc = new Rpc(near);
  const waiting = rpc.call('never');
  rpc.fail(Error('Bonfire Agents stopped'));
  await assert.rejects(waiting, /Bonfire Agents stopped/);
  await assert.rejects(rpc.call('later'), /Bonfire Agents stopped/);
});
