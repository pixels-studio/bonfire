import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  claudeLimits,
  codexLimits,
  mergeCodexLimits,
} from '../electron/main/limits';

test('Claude limits list session, weekly, and per-model windows in that order', () => {
  const limits = claudeLimits({
    subscription_type: 'max',
    rate_limits_available: true,
    rate_limits: {
      five_hour: {
        utilization: 1,
        resets_at: '2026-10-03T10:09:59.742950+00:00',
      },
      seven_day: { utilization: 6, resets_at: null },
      model_scoped: [
        {
          display_name: 'Fable',
          utilization: 0,
          resets_at: '2026-10-09T06:00:00+00:00',
        },
      ],
    },
  });
  assert.equal(limits.plan, 'max');
  assert.deepEqual(
    limits.windows.map(({ label, usedPercent }) => [label, usedPercent]),
    [
      ['Session', 1],
      ['Weekly', 6],
      ['Fable weekly', 0],
    ],
  );
  assert.equal(
    limits.windows[0].resetsAt,
    Date.parse('2026-10-03T10:09:59.742Z'),
  );
  assert.equal(limits.windows[1].resetsAt, undefined);
});

test('Claude limits skip windows without a utilization', () => {
  const limits = claudeLimits({
    subscription_type: 'pro',
    rate_limits_available: true,
    rate_limits: {
      five_hour: null,
      seven_day: { utilization: null, resets_at: null },
    },
  });
  assert.deepEqual(limits.windows, []);
});

test('Claude limits are unavailable without a subscription', () => {
  assert.throws(
    () =>
      claudeLimits({
        subscription_type: null,
        rate_limits_available: false,
        rate_limits: null,
      }),
    /subscription/,
  );
});

test('Codex limits keep only the weekly window, with the reset in milliseconds', () => {
  const limits = codexLimits({
    rateLimits: {
      planType: 'pro',
      primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1 },
      secondary: {
        usedPercent: 40,
        windowDurationMins: 10080,
        resetsAt: 1791582359,
      },
    },
  });
  assert.equal(limits.plan, 'pro');
  assert.deepEqual(limits.windows, [
    { id: 'weekly', label: 'Weekly', usedPercent: 40, resetsAt: 1791582359000 },
  ]);
});

test('A Codex limits update merges into the last read, keeping what it leaves out', () => {
  const previous = {
    provider: 'codex' as const,
    plan: 'pro',
    windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 40 }],
  };
  const weekly = { usedPercent: 41, windowDurationMins: 10080, resetsAt: 2 };
  assert.deepEqual(
    mergeCodexLimits(previous, { rateLimits: { secondary: weekly } }),
    {
      provider: 'codex',
      plan: 'pro',
      windows: [
        { id: 'weekly', label: 'Weekly', usedPercent: 41, resetsAt: 2000 },
      ],
    },
  );
  // Only the short window came: the weekly one stays as it was.
  assert.deepEqual(
    mergeCodexLimits(previous, {
      rateLimits: { primary: { usedPercent: 5, windowDurationMins: 300 } },
    }),
    previous,
  );
  // Another bucket's update says nothing of the plan's limits.
  assert.equal(
    mergeCodexLimits(previous, {
      rateLimits: { limitId: 'gpt-5-mini', secondary: weekly },
    }),
    previous,
  );
  // Nothing read yet: the next read asks.
  assert.equal(
    mergeCodexLimits(undefined, { rateLimits: { secondary: weekly } }),
    undefined,
  );
});
