import type {
  AssistantProvider,
  Preferences,
  Project,
  ProjectSettings,
  Session,
  State,
} from './contracts';

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
  branchPrefix: 'bonfire/',
  deleteBranchOnArchive: false,
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

/** Short names for workspace folders: planets, dwarf planets, and moons. */
export const WORKSPACE_NAMES = [
  'mercury',
  'venus',
  'earth',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
  'pluto',
  'ceres',
  'eris',
  'haumea',
  'makemake',
  'sedna',
  'luna',
  'phobos',
  'deimos',
  'io',
  'europa',
  'ganymede',
  'callisto',
  'titan',
  'enceladus',
  'mimas',
  'rhea',
  'iapetus',
  'dione',
  'tethys',
  'miranda',
  'ariel',
  'oberon',
  'titania',
  'triton',
  'charon',
];

/**
 * A random workspace name not in `taken`. Once every name is in use, names get a
 * number: `europa-2`, then `europa-3`.
 */
export function pickWorkspaceName(
  taken: (name: string) => boolean,
  random = Math.random,
) {
  for (let round = 1; ; round++) {
    const free = WORKSPACE_NAMES.map((name) =>
      round === 1 ? name : `${name}-${round}`,
    ).filter((name) => !taken(name));
    if (free.length) return free[Math.floor(random() * free.length)];
  }
}

const SLUG_MAX_LENGTH = 40;

/** Turns a title into a branch-safe slug: "Fix dropdown height" becomes `fix-dropdown-height`. */
export function slugify(text: string) {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/^-+|-+$/g, '');
}

/** `base`, or `base-2`, `base-3`… for the first one `taken` doesn't claim. */
export function uniqueName(base: string, taken: (name: string) => boolean) {
  if (!taken(base)) return base;
  for (let suffix = 2; ; suffix++)
    if (!taken(`${base}-${suffix}`)) return `${base}-${suffix}`;
}

export const DEFAULT_FILES_TO_COPY = '.env*';

/** A project's settings, with its overrides applied over the app-wide preferences. */
export function resolveProjectSettings(
  project: Project,
  preferences: Preferences,
): ProjectSettings & {
  branchPrefix: string;
  archiveOnMerge: boolean;
  deleteBranchOnArchive: boolean;
} {
  const { settings } = project;
  return {
    baseBranch: settings.baseBranch ?? '',
    setupScript: settings.setupScript ?? '',
    archiveScript: settings.archiveScript ?? '',
    filesToCopy: settings.filesToCopy ?? '',
    branchPrefix: settings.branchPrefix ?? preferences.branchPrefix,
    archiveOnMerge: settings.archiveOnMerge ?? preferences.archiveOnMerge,
    deleteBranchOnArchive:
      settings.deleteBranchOnArchive ?? preferences.deleteBranchOnArchive,
  };
}

/** Whether the workspace is a worktree of its own rather than the project folder. */
export function isWorktree(session: Session) {
  return session.name !== undefined;
}

/** What a workspace is called in menus. */
export function workspaceLabel(session: Session) {
  if (!isWorktree(session)) return 'Project folder';
  return session.title || session.name!;
}
