import assert from 'node:assert/strict';
import { test } from 'node:test';
import { noticeBody } from '../electron/main/notifier';
import { cleanTitle, titlePrompt } from '../electron/main/titles';
import {
  DEFAULT_PREFERENCES,
  DEFAULT_WALLPAPER,
  resolvePreferences,
} from '../shared/domain';
import { stateSchema } from '../shared/contracts';
import { wallpaperById } from '../src/lib/wallpapers';

test('unset preferences fall back to the defaults', () => {
  assert.deepEqual(resolvePreferences({}), DEFAULT_PREFERENCES);
  assert.equal(resolvePreferences({ followUp: 'steer' }).followUp, 'steer');
});

test('state saved before preferences existed still loads', () => {
  const state = stateSchema.parse({
    version: 1,
    projects: [],
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

test('an unknown wallpaper falls back to the default', () => {
  assert.equal(wallpaperById(DEFAULT_WALLPAPER).id, DEFAULT_WALLPAPER);
  assert.equal(wallpaperById('gone').id, DEFAULT_WALLPAPER);
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

test('action prompts default, and an empty edit falls back to the default', async () => {
  const { actionPrompt, DEFAULT_ACTION_PROMPTS } =
    await import('../shared/domain');
  const prefs = resolvePreferences({
    actionPrompts: { push: 'Squash first', fixChecks: '  ' },
  });
  assert.equal(actionPrompt(prefs, 'push'), 'Squash first');
  assert.equal(
    actionPrompt(prefs, 'fixChecks'),
    DEFAULT_ACTION_PROMPTS.fixChecks,
  );
  assert.equal(prefs.actionPrompts.createPr, DEFAULT_ACTION_PROMPTS.createPr);
});
