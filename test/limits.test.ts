import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claudeLimits, codexLimits } from '../electron/main/limits';

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
