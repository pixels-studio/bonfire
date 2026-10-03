import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  stateSchema,
  type Preferences,
  type State,
} from '../../shared/contracts';
import { emptyState, resolvePreferences } from '../../shared/domain';

/** How long writes are held back so a burst of changes costs one write. */
const SAVE_DELAY_MS = 250;

/**
 * Atomically persisted application state; lookups throw when an id is unknown.
 * Saves are debounced, so call `flush()` before the process exits.
 */
export class Store {
  state: State;
  private readonly file: string;
  private saveTimer?: NodeJS.Timeout;

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.file = join(directory, 'state.json');
    this.state = existsSync(this.file)
      ? stateSchema.parse(migrate(JSON.parse(readFileSync(this.file, 'utf8'))))
      : emptyState();
    settleInterrupted(this.state);
    settleProjects(this.state);
  }

  /** Schedules a write; changes made before it fires share it. */
  save() {
    this.saveTimer ??= setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  /** Writes any pending changes now. */
  flush() {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const temporaryFile = `${this.file}.tmp`;
    writeFileSync(temporaryFile, JSON.stringify(this.state), { mode: 0o600 });
    renameSync(temporaryFile, this.file);
  }

  /** The user's preferences, with defaults for anything unset. */
  get preferences(): Preferences {
    return resolvePreferences(this.state.preferences);
  }

  project(id: string) {
    return find(this.state.projects, id, 'Project');
  }

  pane(id: string) {
    return find(this.state.panes, id, 'Pane');
  }
}

/** Turns that were cut off by a crash or quit leave messages that would look busy forever. */
function settleInterrupted(state: State) {
  for (const pane of state.panes)
    for (const message of pane.messages)
      if (message.status === 'streaming')
        message.status = message.kind === 'tool' ? 'failed' : 'complete';
}

type RawPane = {
  id: string;
  projectId?: string;
  sessionId?: string;
  messages?: unknown[];
  archived?: boolean;
};
type RawState = {
  layout?: { paneIds: string[] };
  lastSessionId?: string;
  currentSessionId?: string;
  lastProjectId?: string;
  projects?: { id: string; path: string }[];
  sessions?: {
    id: string;
    projectId?: string;
    worktreePath?: string;
    layout?: { paneIds: string[] };
  }[];
  panes?: RawPane[];
};

/**
 * Brings older state in line. Layout used to live on each session, and panes used to
 * belong to workspaces: worktrees of their project, or the project folder itself. Panes
 * now belong to the project folder. Those that worked in a worktree are archived, since
 * their changes and agent sessions live in that folder; those that never started are dropped.
 */
export function migrate(raw: RawState) {
  if (!raw.layout) {
    const session = raw.sessions?.find(({ id }) => id === raw.lastSessionId);
    raw.layout = { paneIds: session?.layout?.paneIds ?? [] };
  }
  if (!raw.sessions) return raw;
  const sessions = new Map(
    raw.sessions.map((session) => [session.id, session]),
  );
  const folders = new Map(
    (raw.projects ?? []).map(({ id, path }) => [id, path]),
  );
  const dropped = new Set<string>();
  for (const pane of raw.panes ?? []) {
    if (!pane.sessionId) continue;
    const session = sessions.get(pane.sessionId);
    delete pane.sessionId;
    if (!session?.projectId) continue;
    pane.projectId = session.projectId;
    if (session.worktreePath === folders.get(session.projectId)) continue;
    if (pane.messages?.length) pane.archived = true;
    else dropped.add(pane.id);
  }
  raw.panes = raw.panes?.filter(({ id }) => !dropped.has(id));
  raw.layout.paneIds = raw.layout.paneIds.filter((id) => !dropped.has(id));
  const current = raw.currentSessionId && sessions.get(raw.currentSessionId);
  if (current && current.projectId) raw.lastProjectId = current.projectId;
  delete raw.sessions;
  delete raw.currentSessionId;
  return raw;
}

/**
 * Panes that never picked a project are archived, or dropped if they never started, and
 * the project on screen is one that exists.
 */
export function settleProjects(state: State) {
  const orphans = new Set(
    state.panes
      .filter((pane) => !pane.projectId && !pane.messages.length)
      .map(({ id }) => id),
  );
  state.panes = state.panes.filter(({ id }) => !orphans.has(id));
  state.layout.paneIds = state.layout.paneIds.filter((id) => !orphans.has(id));
  for (const pane of state.panes) if (!pane.projectId) pane.archived = true;
  if (!state.projects.some(({ id }) => id === state.lastProjectId))
    state.lastProjectId = state.projects[0]?.id;
}

function find<Item extends { id: string }>(
  items: Item[],
  id: string,
  label: string,
) {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw Error(`${label} not found`);
  return item;
}
