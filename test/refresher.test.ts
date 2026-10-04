import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextDelay, Refresher, type Page } from '../src/lib/refresher';
import { sleep } from './helpers';

function fakePage() {
  const listeners = new Set<() => void>();
  const state = { visible: true };
  const page: Page = {
    visible: () => state.visible,
    onReturn(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    page,
    hide: () => (state.visible = false),
    show() {
      state.visible = true;
      for (const listener of listeners) listener();
    },
  };
}

/** A load that takes `ms`, counting how many ran and the most that ran at once. */
function slowLoad(ms: number) {
  const counts = { loads: 0, active: 0, mostActive: 0 };
  const load = async () => {
    counts.loads++;
    counts.mostActive = Math.max(counts.mostActive, ++counts.active);
    await sleep(ms);
    counts.active--;
  };
  return { counts, load };
}

test('changes during a load set off one more load, never an overlapping one', async () => {
  const { counts, load } = slowLoad(20);
  const refresher = new Refresher(load, { page: fakePage().page });
  void refresher.refresh();
  refresher.invalidate();
  refresher.invalidate();
  refresher.invalidate();
  await sleep(80);
  assert.equal(counts.loads, 2);
  assert.equal(counts.mostActive, 1);
  refresher.stop();
});

test('a refresh asked for during a load settles after a load that started later', async () => {
  const { counts, load } = slowLoad(20);
  const refresher = new Refresher(load, { page: fakePage().page });
  void refresher.refresh();
  await refresher.refresh();
  assert.equal(counts.loads, 2);
  assert.equal(counts.active, 0);
  refresher.stop();
});

test('nothing loads while out of view; what changed loads once on return', async () => {
  const { counts, load } = slowLoad(0);
  const { page, hide, show } = fakePage();
  const refresher = new Refresher(load, { page });
  hide();
  refresher.invalidate();
  refresher.invalidate();
  await sleep(10);
  assert.equal(counts.loads, 0);
  show();
  await sleep(10);
  assert.equal(counts.loads, 1);
  show();
  await sleep(10);
  assert.equal(counts.loads, 1, 'nothing changed since, so nothing loads');
  refresher.stop();
});

test('without an interval it never loads on its own', async () => {
  const { counts, load } = slowLoad(0);
  const refresher = new Refresher(load, { page: fakePage().page });
  await sleep(40);
  assert.equal(counts.loads, 0);
  refresher.stop();
});

test('with an interval it checks back until the interval is taken away', async () => {
  const { counts, load } = slowLoad(0);
  const refresher = new Refresher(load, {
    intervalMs: 10,
    page: fakePage().page,
  });
  await sleep(55);
  assert.ok(counts.loads >= 3, `loaded ${counts.loads} times`);
  refresher.setInterval(undefined);
  await sleep(15);
  const loads = counts.loads;
  await sleep(40);
  assert.equal(counts.loads, loads);
  refresher.stop();
});

test('changes closer together than the gap load once the gap has passed', async () => {
  const { counts, load } = slowLoad(0);
  const refresher = new Refresher(load, {
    minGapMs: 40,
    page: fakePage().page,
  });
  await refresher.refresh();
  refresher.invalidate();
  refresher.invalidate();
  await sleep(20);
  assert.equal(counts.loads, 1);
  await sleep(40);
  assert.equal(counts.loads, 2);
  refresher.stop();
});

test('a change can ask for a longer gap than the usual one', async () => {
  const { counts, load } = slowLoad(0);
  const refresher = new Refresher(load, {
    minGapMs: 0,
    page: fakePage().page,
  });
  await refresher.refresh();
  refresher.invalidate(50);
  await sleep(25);
  assert.equal(counts.loads, 1);
  refresher.invalidate();
  await sleep(10);
  assert.equal(counts.loads, 2, 'a change that matters goes ahead at once');
  refresher.stop();
});

test('a load that throws at once does not wedge it', async () => {
  let loads = 0;
  const refresher = new Refresher(
    () => {
      loads++;
      throw Error('offline');
    },
    { page: fakePage().page },
  );
  await refresher.refresh();
  await refresher.refresh();
  assert.equal(loads, 2);
  refresher.stop();
});

test('nothing loads once stopped', async () => {
  const { counts, load } = slowLoad(0);
  const refresher = new Refresher(load, {
    intervalMs: 5,
    page: fakePage().page,
  });
  refresher.stop();
  refresher.invalidate();
  await refresher.refresh();
  await sleep(20);
  assert.equal(counts.loads, 0);
});

test('checks fall on the clock, so views checking the same thing ask together', () => {
  assert.equal(nextDelay(5000, 0, 12_000), 3000);
  assert.equal(nextDelay(5000, 0, 15_000), 5000);
});

test('failures in a row wait longer each time, up to the most, spread apart', () => {
  const low = { random: () => 0 };
  const high = { random: () => 1 };
  const delay = (...args: Parameters<typeof nextDelay>) =>
    Math.round(nextDelay(...args));
  assert.equal(delay(1000, 1, 0, low), 1600);
  assert.equal(delay(1000, 1, 0, high), 2400);
  assert.equal(delay(1000, 3, 0, low), 6400);
  assert.equal(delay(1000, 20, 0, { maxMs: 60_000, ...high }), 72_000);
});
