import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACCENT_RANGE, accentHue, accentSliderValue } from '../src/lib/accent';
import { noticeBody } from '../electron/main/notifier';
import { cleanTitle, titlePrompt } from '../electron/main/titles';
import {
  DEFAULT_ACCENT_HUE,
  DEFAULT_PREFERENCES,
  resolvePreferences,
} from '../shared/domain';
import { stateSchema } from '../shared/contracts';

test('unset preferences fall back to the defaults', () => {
  assert.deepEqual(resolvePreferences({}), DEFAULT_PREFERENCES);
  assert.equal(resolvePreferences({ followUp: 'steer' }).followUp, 'steer');
});

test('state saved before preferences existed still loads', () => {
  const state = stateSchema.parse({
    version: 1,
    projects: [],
    sessions: [],
    panes: [
      {
        id: crypto.randomUUID(),
        type: 'claude',
        title: 'Old',
      },
    ],
    layout: { paneIds: [] },
    settings: {},
  });
  assert.deepEqual(state.preferences, {});
  // Panes from before permissions were configurable keep running unattended.
  assert.equal(state.panes[0].approvals, 'auto');
});

test('accent hues round-trip through the slider', () => {
  for (const hue of [DEFAULT_ACCENT_HUE, 0, 149, 230, 300, 359])
    assert.equal(accentHue(accentSliderValue(hue)), hue);
  const value = accentSliderValue(DEFAULT_ACCENT_HUE);
  assert(value >= ACCENT_RANGE.min && value <= ACCENT_RANGE.max);
});

test('hues outside the slider snap to its nearer end', () => {
  assert.equal(accentSliderValue(160), ACCENT_RANGE.max);
  assert.equal(accentSliderValue(220), ACCENT_RANGE.min);
});

test('titles are pulled out of quotes, labels, and markdown', () => {
  assert.equal(cleanTitle('"Fix the login flow."'), 'Fix the login flow');
  assert.equal(cleanTitle('Title: **Add dark mode**\n\nmore'), 'Add dark mode');
  assert.equal(cleanTitle('   \n'), undefined);
  assert(titlePrompt('x'.repeat(10_000)).length < 3_000);
});

test('notifications cover finishing, failing, and waiting on the user', () => {
  const status = (value: 'running' | 'completed' | 'failed' | 'idle') => ({
    paneId: 'p',
    type: 'status' as const,
    status: value,
  });
  assert.equal(noticeBody(status('completed'), 'Claude'), 'Claude finished');
  assert.equal(noticeBody(status('failed'), 'Claude'), 'Claude failed');
  assert.equal(noticeBody(status('running'), 'Claude'), undefined);
  assert.equal(noticeBody(status('idle'), 'Claude'), undefined);
  assert.equal(
    noticeBody(
      {
        paneId: 'p',
        type: 'request',
        request: {
          id: 'r',
          kind: 'approval',
          title: 'Run npm test',
          detail: '',
          canRemember: false,
        },
      },
      'Codex',
    ),
    'Codex needs approval: Run npm test',
  );
});
