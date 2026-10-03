import type {
  AssistantProvider,
  Pane,
  Preferences,
  Project,
  SshConnection,
  State,
  ToolPaneType,
} from './contracts';

export const DEFAULT_TITLE = 'New Conversation';
const TITLE_MAX_LENGTH = 42;

export const PROVIDER_LABELS: Record<AssistantProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
};

/** What tool panes are called; agent panes are named after their conversation. */
export const TOOL_PANE_TITLES: Record<ToolPaneType, string> = {
  files: 'Files',
  terminal: 'Terminal',
  diff: 'Changes',
};

/** Whether the pane is a conversation with an agent, rather than a tool pane. */
export function isAssistantPane(
  pane: Pane,
): pane is Pane & { type: AssistantProvider } {
  return pane.type in PROVIDER_LABELS;
}

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
    panes: [],
    connections: [],
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

/** What went wrong, without the wrapping Electron adds to errors thrown in main. */
export function errorMessage(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.replace(
    /^Error invoking remote method '[^']*': (Error: )?/,
    '',
  );
}

/** The most panes, of any type, a project can have open at once. */
export const MAX_PANES = 12;

/**
 * Reorders `ids` among the layout slots they already occupy, leaving every other
 * pane (archived, another project's) where it was. Throws if `ids` isn't a subset of the layout.
 */
export function reorderLayout(paneIds: string[], ids: string[]) {
  const moving = new Set(ids);
  if (moving.size !== ids.length || ids.some((id) => !paneIds.includes(id)))
    throw new Error('Invalid pane order');
  const queue = [...ids];
  return paneIds.map((id) => (moving.has(id) ? queue.shift()! : id));
}

/** Where a project lives: its connection's name, or this computer. */
export function projectLocation(
  project: Pick<Project, 'connectionId'>,
  connections: SshConnection[],
) {
  if (!project.connectionId) return 'This computer';
  return (
    connections.find(({ id }) => id === project.connectionId)?.name ??
    'Removed connection'
  );
}

/** The last segment of a path, for naming a project after its folder. */
export function folderName(path: string) {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? ''
  );
}
