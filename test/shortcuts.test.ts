import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SHORTCUTS,
  chordKeys,
  digitOf,
  matchShortcut,
  shortcutKeys,
  shortcutText,
  type ShortcutId,
} from '../src/lib/shortcuts';

function press(
  key: string,
  code: string,
  modifiers: Partial<
    Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>
  > = {},
) {
  return {
    key,
    code,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  };
}

test('⌘ is the modifier on macOS and Ctrl elsewhere', () => {
  assert.equal(
    matchShortcut(press('t', 'KeyT', { metaKey: true }), true, 'global'),
    'newTerminal',
  );
  assert.equal(
    matchShortcut(press('t', 'KeyT', { ctrlKey: true }), true, 'global'),
    undefined,
  );
  assert.equal(
    matchShortcut(press('t', 'KeyT', { ctrlKey: true }), false, 'global'),
    'newTerminal',
  );
  assert.equal(
    matchShortcut(press('t', 'KeyT', { metaKey: true }), false, 'global'),
    undefined,
  );
});

test('extra modifiers pick a different shortcut', () => {
  const mac = (key: string, code: string, shiftKey = false) =>
    matchShortcut(
      press(key, code, { metaKey: true, shiftKey }),
      true,
      'global',
    );
  assert.equal(mac('n', 'KeyN'), 'newConversation');
  assert.equal(mac('N', 'KeyN', true), 'newBranch');
  assert.equal(mac('p', 'KeyP'), 'switchProject');
  assert.equal(mac('P', 'KeyP', true), 'pullRequest');
  assert.equal(mac('i', 'KeyI'), 'insights');
  assert.equal(mac('U', 'KeyU', true), 'usage');
});

test('⌥ chords match by the physical key, whatever ⌥ types', () => {
  assert.equal(
    matchShortcut(
      press('¡', 'Digit1', { metaKey: true, altKey: true }),
      true,
      'global',
    ),
    'openProject',
  );
  assert.equal(
    matchShortcut(
      press('ArrowLeft', 'ArrowLeft', { metaKey: true, altKey: true }),
      true,
      'global',
    ),
    'previousPane',
  );
  assert.equal(
    matchShortcut(
      press('ArrowRight', 'ArrowRight', {
        metaKey: true,
        altKey: true,
        shiftKey: true,
      }),
      true,
      'global',
    ),
    'movePaneRight',
  );
});

test('a shortcut can have alternative chords', () => {
  const bracket = press(']', 'BracketRight', { metaKey: true });
  assert.equal(matchShortcut(bracket, true, 'global'), 'nextPane');
  assert.deepEqual(shortcutKeys('nextPane', true), [
    ['⌘', '⌥', '→'],
    ['⌘', ']'],
  ]);
});

test('digits go to a pane, and with ⌥ to a project', () => {
  const event = press('3', 'Digit3', { metaKey: true });
  assert.equal(matchShortcut(event, true, 'global'), 'goToPane');
  assert.equal(digitOf(event), 3);
  assert.equal(
    matchShortcut({ ...event, altKey: true }, true, 'global'),
    'openProject',
  );
  assert.equal(digitOf(press('0', 'Digit0')), undefined);
  assert.equal(
    matchShortcut(press('0', 'Digit0', { metaKey: true }), true, 'global'),
    undefined,
  );
});

test('scopes keep composer keys out of the global handler', () => {
  assert.equal(
    matchShortcut(press('Escape', 'Escape'), true, 'global'),
    undefined,
  );
  assert.equal(
    matchShortcut(press('Escape', 'Escape'), true, 'composer'),
    'stop',
  );
  assert.equal(
    matchShortcut(press('u', 'KeyU', { metaKey: true }), true, 'composer'),
    'attach',
  );
  assert.equal(
    matchShortcut(
      press('Enter', 'Enter', { shiftKey: true }),
      true,
      'composer',
    ),
    'newline',
  );
  assert.equal(
    matchShortcut(press('Enter', 'Enter', { metaKey: true }), true, 'composer'),
    'sendInverted',
  );
});

test('no two shortcuts share a chord', () => {
  for (const mac of [true, false]) {
    const seen = new Map<string, ShortcutId>();
    for (const id of Object.keys(SHORTCUTS) as ShortcutId[])
      for (const keys of shortcutKeys(id, mac)) {
        const text = `${SHORTCUTS[id].scope}:${keys.join('+')}`;
        assert.equal(seen.get(text), undefined, `${text} is used twice`);
        seen.set(text, id);
      }
  }
});

test('keycaps are symbols on macOS and words elsewhere', () => {
  assert.deepEqual(chordKeys(SHORTCUTS.newBranch.chords[0], true), [
    '⌘',
    '⇧',
    'N',
  ]);
  assert.deepEqual(chordKeys(SHORTCUTS.newBranch.chords[0], false), [
    'Ctrl',
    'Shift',
    'N',
  ]);
  assert.equal(shortcutText('newBranch', true), '⌘⇧N');
  assert.equal(shortcutText('newBranch', false), 'Ctrl+Shift+N');
  assert.deepEqual(shortcutKeys('stop', true), [['Esc']]);
  assert.deepEqual(shortcutKeys('goToPane', true), [['⌘', '1–9']]);
});
