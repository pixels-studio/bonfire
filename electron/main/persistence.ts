import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
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
    settleWorkspaces(this.state);
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

  session(id: string) {
    return find(this.state.sessions, id, 'Session');
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

/**
 * Brings state from before workspaces in line: each project gets a single default
 * workspace on its folder, panes that never picked a project are dropped, and a
 * workspace is chosen to show.
 */
export function settleWorkspaces(state: State) {
  for (const project of state.projects) {
    const defaults = state.sessions
      .filter(
        (session) =>
          session.projectId === project.id &&
          session.name === undefined &&
          session.worktreePath === project.path,
      )
      .sort((first, second) => second.lastOpenedAt - first.lastOpenedAt);
    const [kept, ...extra] = defaults;
    const merged = new Set(extra.map(({ id }) => id));
    for (const pane of state.panes)
      if (pane.sessionId && merged.has(pane.sessionId))
        pane.sessionId = kept.id;
    state.sessions = state.sessions.filter(({ id }) => !merged.has(id));
  }
  // Worktrees made before workspaces had names are named after their folder.
  for (const session of state.sessions) {
    const project = state.projects.find(({ id }) => id === session.projectId);
    if (session.name === undefined && session.worktreePath !== project?.path)
      session.name = basename(session.worktreePath).slice(0, 8);
  }
  const orphans = new Set(
    state.panes
      .filter((pane) => !pane.sessionId && !pane.messages.length)
      .map(({ id }) => id),
  );
  state.panes = state.panes.filter(({ id }) => !orphans.has(id));
  state.layout.paneIds = state.layout.paneIds.filter((id) => !orphans.has(id));
  for (const pane of state.panes) if (!pane.sessionId) pane.archived = true;

  const current = state.sessions.find(
    ({ id }) => id === state.currentSessionId,
  );
  if (current && !current.archived) return;
  const open = state.sessions
    .filter((session) => !session.archived)
    .sort((first, second) => second.lastOpenedAt - first.lastOpenedAt);
  const next =
    open.find(({ projectId }) => projectId === state.lastProjectId) ?? open[0];
  state.currentSessionId = next?.id;
  if (next) state.lastProjectId = next.projectId;
}

/** Layout used to live on each session; the last-open session's panes become the workspace. */
function migrate(raw: {
  layout?: unknown;
  lastSessionId?: string;
  sessions?: { id: string; layout?: { paneIds: string[] } }[];
}) {
  if (raw.layout) return raw;
  const session = raw.sessions?.find(({ id }) => id === raw.lastSessionId);
  return { ...raw, layout: { paneIds: session?.layout?.paneIds ?? [] } };
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
