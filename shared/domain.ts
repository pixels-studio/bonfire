import type { AssistantProvider, State } from './contracts';

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
  };
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
