import assert from 'node:assert/strict';
import { test } from 'node:test';
import { limitsPace, tokensPace } from '../src/lib/components/insights/pace';
import type { ProviderLimits } from '../shared/contracts';

const claude = (...used: number[]): ProviderLimits => ({
  provider: 'claude',
  windows: used.map((usedPercent, index) => ({
    id: String(index),
    label: String(index),
    usedPercent,
  })),
});

test('Nothing is checked on between turns while no agent works', () => {
  assert.equal(tokensPace(false).intervalMs, undefined);
  assert.equal(limitsPace('codex', undefined, false).intervalMs, undefined);
  assert.equal(limitsPace('claude', claude(95), false).intervalMs, undefined);
  // Turns ending still load, at the same gap.
  assert.equal(limitsPace('claude', claude(95), false).minGapMs, 15_000);
});

test('Token stats and Codex limits, cheap to read, load soon after turns end', () => {
  assert.deepEqual(tokensPace(true), { minGapMs: 2_000, intervalMs: 60_000 });
  assert.deepEqual(limitsPace('codex', undefined, true), {
    minGapMs: 2_000,
    intervalMs: 300_000,
  });
});

test('Claude limits are read more often only as the most used window nears its limit', () => {
  assert.deepEqual(limitsPace('claude', undefined, true), {
    minGapMs: 60_000,
    intervalMs: 300_000,
  });
  assert.deepEqual(limitsPace('claude', claude(19, 40, 3), true), {
    minGapMs: 60_000,
    intervalMs: 300_000,
  });
  assert.deepEqual(limitsPace('claude', claude(19, 75), true), {
    minGapMs: 30_000,
    intervalMs: 120_000,
  });
  assert.deepEqual(limitsPace('claude', claude(92, 40), true), {
    minGapMs: 15_000,
    intervalMs: 60_000,
  });
});
