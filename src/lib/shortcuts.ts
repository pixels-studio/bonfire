/** Stands for the digit keys 1 to 9, which one shortcut covers. */
export const DIGITS = '1-9';

/** A key with the modifiers held; `mod` is ⌘ on macOS and Ctrl elsewhere. */
export type Chord = {
  /** What `KeyboardEvent.key` reports, e.g. "t", ",", "ArrowLeft" or "Escape". */
  key: string;
  mod?: boolean;
  alt?: boolean;
  shift?: boolean;
  /** The keycap to show instead of the key's own, e.g. "10–18" for ⇧ with the digits. */
  label?: string;
};

export type ShortcutGroup = 'General' | 'Projects' | 'Panes' | 'Conversation';

/**
 * `global` shortcuts work anywhere in the window; `composer` ones only while
 * the message box has focus, where the composer handles them itself.
 */
type Scope = 'global' | 'composer';

type Definition = {
  group: ShortcutGroup;
  label: string;
  scope: Scope;
  /** The first chord is the one hints show; the rest are alternatives. */
  chords: Chord[];
};

const mod = (key: string, extra: Omit<Chord, 'key' | 'mod'> = {}): Chord => ({
  key,
  mod: true,
  ...extra,
});

function define<Id extends string>(shortcuts: Record<Id, Definition>) {
  return shortcuts;
}

/** Every keyboard shortcut, in the order the shortcuts dialog lists them. */
export const SHORTCUTS = define({
  shortcuts: {
    group: 'General',
    label: 'Keyboard shortcuts',
    scope: 'global',
    chords: [mod('/')],
  },
  settings: {
    group: 'General',
    label: 'Settings',
    scope: 'global',
    chords: [mod(',')],
  },
  insights: {
    group: 'General',
    label: 'Insights',
    scope: 'global',
    chords: [mod('i')],
  },
  run: {
    group: 'General',
    label: 'Run or stop the project',
    scope: 'global',
    chords: [mod('r')],
  },
  addProject: {
    group: 'Projects',
    label: 'Add project',
    scope: 'global',
    chords: [mod('o')],
  },
  switchProject: {
    group: 'Projects',
    label: 'Switch project',
    scope: 'global',
    chords: [mod('p')],
  },
  newWorkspace: {
    group: 'Projects',
    label: 'New workspace',
    scope: 'global',
    chords: [mod('b')],
  },
  pullRequest: {
    group: 'Projects',
    label: 'Show or hide pull request',
    scope: 'global',
    chords: [mod('p', { shift: true })],
  },
  newConversation: {
    group: 'Panes',
    label: 'New conversation',
    scope: 'global',
    chords: [mod('n')],
  },
  newOtherAgent: {
    group: 'Panes',
    label: 'New conversation with the other agent',
    scope: 'global',
    chords: [mod('n', { shift: true })],
  },
  newTerminal: {
    group: 'Panes',
    label: 'New terminal',
    scope: 'global',
    chords: [mod('t')],
  },
  newFiles: {
    group: 'Panes',
    label: 'Toggle files',
    scope: 'global',
    chords: [mod('e')],
  },
  newDiff: {
    group: 'Panes',
    label: 'Toggle code diff',
    scope: 'global',
    chords: [mod('d')],
  },
  newBrowser: {
    group: 'Panes',
    label: 'Toggle browser',
    scope: 'global',
    chords: [mod('k')],
  },
  closePane: {
    group: 'Panes',
    label: 'Close pane',
    scope: 'global',
    chords: [mod('w', { shift: true })],
  },
  reopenPane: {
    group: 'Panes',
    label: 'Reopen closed pane',
    scope: 'global',
    chords: [mod('t', { shift: true })],
  },
  goToPane: {
    group: 'Panes',
    label: 'Go to pane 1–9',
    scope: 'global',
    chords: [mod(DIGITS)],
  },
  goToFarPane: {
    group: 'Panes',
    label: 'Go to pane 10–18',
    scope: 'global',
    chords: [mod(DIGITS, { shift: true, label: '1–9' })],
  },
  previousPane: {
    group: 'Panes',
    label: 'Previous pane',
    scope: 'global',
    chords: [mod('[')],
  },
  nextPane: {
    group: 'Panes',
    label: 'Next pane',
    scope: 'global',
    chords: [mod(']')],
  },
  resizePane: {
    group: 'Panes',
    label: 'Cycle pane size',
    scope: 'global',
    chords: [mod('\\')],
  },
  focusComposer: {
    group: 'Conversation',
    label: 'Focus message box',
    scope: 'global',
    chords: [mod('l')],
  },
  send: {
    group: 'Conversation',
    label: 'Send message',
    scope: 'composer',
    chords: [{ key: 'Enter' }],
  },
  newline: {
    group: 'Conversation',
    label: 'New line',
    scope: 'composer',
    chords: [{ key: 'Enter', shift: true }],
  },
  sendInverted: {
    group: 'Conversation',
    label: 'Send as the other follow-up (queue or steer)',
    scope: 'composer',
    chords: [mod('Enter')],
  },
  attach: {
    group: 'Conversation',
    label: 'Add attachment',
    scope: 'composer',
    chords: [mod('u')],
  },
  stop: {
    group: 'Conversation',
    label: 'Stop response',
    scope: 'composer',
    chords: [{ key: 'Escape' }],
  },
});

export type ShortcutId = keyof typeof SHORTCUTS;

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  'General',
  'Projects',
  'Panes',
  'Conversation',
];

type KeyEventLike = Pick<
  KeyboardEvent,
  'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'
>;

/** The physical key a chord's `key` sits on, which holds when ⌥ changes what the key types. */
function codeOf(key: string) {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^\d$/.test(key)) return `Digit${key}`;
  return (
    {
      ',': 'Comma',
      '/': 'Slash',
      '\\': 'Backslash',
      '[': 'BracketLeft',
      ']': 'BracketRight',
    }[key] ?? key
  );
}

/** The digit 1 to 9 a key event is for, whatever ⌥ turned it into. */
export function digitOf(event: Pick<KeyboardEvent, 'code'>) {
  const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
  return digit ? Number(digit) : undefined;
}

export function matchesChord(event: KeyEventLike, chord: Chord, mac: boolean) {
  const modifier = mac ? event.metaKey : event.ctrlKey;
  const stray = mac ? event.ctrlKey : event.metaKey;
  if (
    modifier !== !!chord.mod ||
    stray ||
    event.altKey !== !!chord.alt ||
    event.shiftKey !== !!chord.shift
  )
    return false;
  if (chord.key === DIGITS) return digitOf(event) !== undefined;
  return (
    event.code === codeOf(chord.key) ||
    (!chord.alt && event.key.toLowerCase() === chord.key.toLowerCase())
  );
}

/** The shortcut of `scope` an event is for, if any. */
export function matchShortcut(
  event: KeyEventLike,
  mac: boolean,
  scope: Scope,
): ShortcutId | undefined {
  const shortcuts = Object.entries(SHORTCUTS) as [ShortcutId, Definition][];
  return shortcuts.find(
    ([, shortcut]) =>
      shortcut.scope === scope &&
      shortcut.chords.some((chord) => matchesChord(event, chord, mac)),
  )?.[0];
}

const KEY_LABELS: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Enter: '↵',
  Escape: 'Esc',
  [DIGITS]: '1–9',
};

/** The keycaps for a chord: `['⌘', '⇧', 'N']` on macOS, `['Ctrl', 'Shift', 'N']` elsewhere. */
export function chordKeys(chord: Chord, mac: boolean) {
  return [
    ...(chord.mod ? [mac ? '⌘' : 'Ctrl'] : []),
    ...(chord.alt ? [mac ? '⌥' : 'Alt'] : []),
    ...(chord.shift ? [mac ? '⇧' : 'Shift'] : []),
    chord.label ?? KEY_LABELS[chord.key] ?? chord.key.toUpperCase(),
  ];
}

/** Every way to trigger a shortcut, each as its keycaps. */
export function shortcutKeys(id: ShortcutId, mac: boolean) {
  return SHORTCUTS[id].chords.map((chord) => chordKeys(chord, mac));
}

/** The primary chord as plain text for a `title`: "⌘⇧N" or "Ctrl+Shift+N". */
export function shortcutText(id: ShortcutId, mac: boolean) {
  return chordKeys(SHORTCUTS[id].chords[0], mac).join(mac ? '' : '+');
}
