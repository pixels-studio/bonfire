import type { AssistantProvider, Preferences, State } from './contracts';

export const DEFAULT_TITLE = 'New Conversation';
const TITLE_MAX_LENGTH = 42;

export const PROVIDER_LABELS: Record<AssistantProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
};

/** Older panes were titled after their provider before the first message. */
export function isDefaultTitle(title: string) {
  return (
    title === DEFAULT_TITLE || Object.values(PROVIDER_LABELS).includes(title)
  );
}

export function titleFrom(text: string) {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > TITLE_MAX_LENGTH
    ? `${compact.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`
    : compact;
}

export function emptyState(): State {
  return {
    version: 1,
    projects: [],
    sessions: [],
    panes: [],
    layout: { paneIds: [] },
    settings: {},
    preferences: {},
  };
}

/** The OKLCH hue of the original orange accent, #ea580c. */
export const DEFAULT_ACCENT_HUE = 41;

/** Pasted text longer than this becomes an attachment when `convertLongText` is on. */
export const LONG_TEXT_THRESHOLD = 5_000;

/** Below this battery charge, in percent, `caffeinate` lets the system sleep again. */
export const CAFFEINATE_BATTERY_FLOOR = 10;

export const DEFAULT_PREFERENCES: Preferences = {
  defaultModel: null,
  approvals: 'auto',
  followUp: 'queue',
  textModel: { provider: 'claude', model: 'haiku' },
  convertLongText: true,
  accentHue: DEFAULT_ACCENT_HUE,
  notifications: true,
  completionSound: false,
  providers: { claude: true, codex: true },
  claudeOutputStyle: 'default',
  codexPersonality: 'default',
  archiveOnMerge: false,
  caffeinate: true,
};

/** Fills in the fields the user hasn't set. */
export function resolvePreferences(stored: Partial<Preferences>): Preferences {
  return { ...DEFAULT_PREFERENCES, ...stored };
}

export function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The most conversation panes that can be open at once. */
export const MAX_PANES = 12;

/**
 * Reorders `ids` among the layout slots they already occupy, leaving every other
 * pane (archived, terminal) where it was. Throws if `ids` isn't a subset of the layout.
 */
export function reorderLayout(paneIds: string[], ids: string[]) {
  const moving = new Set(ids);
  if (moving.size !== ids.length || ids.some((id) => !paneIds.includes(id)))
    throw new Error('Invalid pane order');
  const queue = [...ids];
  return paneIds.map((id) => (moving.has(id) ? queue.shift()! : id));
}
