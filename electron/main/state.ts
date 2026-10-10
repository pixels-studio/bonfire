import type {
  AssistantProvider,
  ConversationMessage,
  Pane,
  Preferences,
  Project,
  ReasoningEffort,
  SshConnection,
  State,
} from '../../shared/contracts';
import { reorderLayout } from '../../shared/domain';

/** A value that can be read but not changed, all the way down. */
export type ReadonlyDeep<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly ReadonlyDeep<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: ReadonlyDeep<T[Key]> }
      : T;

/**
 * The state as everything outside the Store sees it: read freely, changed only through the
 * Store's change groups below, so each change is saved and has one owner to find and test.
 */
export type StateView = ReadonlyDeep<State>;
export type PaneView = ReadonlyDeep<Pane>;
export type ProjectView = ReadonlyDeep<Project>;
export type MessageView = ReadonlyDeep<ConversationMessage>;

/** The Store's own object behind a view it handed out; only the Store changes it. */
export function writable<T>(view: ReadonlyDeep<T>) {
  return view as T;
}

/**
 * State on its way to the window or another process, which gets a copy of its own and may
 * treat it as plain data.
 */
export function sendable<T>(view: ReadonlyDeep<T>) {
  return view as T;
}

/** Pane fields that change after the pane is made; `undefined` clears a field. */
export type PanePatch = Partial<
  Omit<
    Pane,
    | 'id'
    | 'projectId'
    | 'type'
    | 'messages'
    | 'archived'
    | 'archivedAt'
    | 'closedBranch'
  >
>;

export type ProjectPatch = Partial<
  Pick<Project, 'name' | 'lastOpenedAt' | 'scripts' | 'runScriptId'>
>;

/** Schedules a save; a pane whose messages changed has its conversation written too. */
type Save = (pane?: PaneView) => void;

/** Sets each field of the patch, and removes those it sets to `undefined`. */
export function assign<Target extends object>(
  target: Target,
  patch: Partial<Target>,
) {
  for (const [key, value] of Object.entries(patch) as [keyof Target, never][])
    if (value === undefined) delete target[key];
    else target[key] = value;
}

/** Panes: which there are, which are open and in what order, their settings and messages. */
export class PaneChanges {
  constructor(
    private readonly state: () => State,
    private readonly save: Save,
    /** Reads a closed pane's conversation back from disk, if it was left there; throws if it can't. */
    private readonly load: (pane: Pane) => void = () => {},
  ) {}

  /** Adds an open pane at the front of the layout, or at its end. */
  add(pane: Pane, at: 'front' | 'end'): PaneView {
    const { panes, layout } = this.state();
    panes.push(pane);
    if (at === 'front') layout.paneIds.unshift(pane.id);
    else layout.paneIds.push(pane.id);
    this.save();
    return pane;
  }

  update(pane: PaneView, patch: PanePatch) {
    assign(writable<Pane>(pane), patch);
    this.save();
  }

  /**
   * Closes the pane for good; its conversation stays on disk. It is listed under the
   * branch checked out as it closed, when known, else the one its last turn ran on.
   */
  archive(pane: PaneView, branch?: string) {
    const closed = writable<Pane>(pane);
    closed.archived = true;
    closed.archivedAt = Date.now();
    const closedBranch = branch ?? pane.workBranch?.name;
    if (closedBranch) closed.closedBranch = closedBranch;
    else delete closed.closedBranch;
    const { layout } = this.state();
    layout.paneIds = layout.paneIds.filter((id) => id !== pane.id);
    this.save();
  }

  /**
   * Opens a closed pane again at the front of the layout, with its conversation. An open
   * pane is left as it is, so a second request does nothing.
   */
  reopen(pane: PaneView) {
    const reopened = writable<Pane>(pane);
    if (!reopened.archived) return;
    // Loaded first: a pane whose file is still unread would otherwise be saved as empty.
    this.load(reopened);
    reopened.archived = false;
    delete reopened.archivedAt;
    delete reopened.closedBranch;
    // The branch is kept, as closed panes are listed by it, but counted from now: a pull
    // request merged before the pane reopened would otherwise close it again.
    if (reopened.workBranch)
      reopened.workBranch = { ...reopened.workBranch, since: Date.now() };
    // A turn stopped as the pane closed can leave a message that would look busy forever.
    settleMessages(reopened);
    this.state().layout.paneIds.unshift(reopened.id);
    // Saved twice: the pane's conversation is written, and the open panes changed, which
    // the agent host's copy needs to hear of or it can't find the pane to send to.
    this.save(reopened);
    this.save();
  }

  reorder(ids: string[]) {
    const { layout } = this.state();
    layout.paneIds = reorderLayout(layout.paneIds, ids);
    this.save();
  }

  /** Drops panes and their conversations altogether. */
  remove(ids: Iterable<string>) {
    const removed = new Set(ids);
    const state = this.state();
    state.panes = state.panes.filter(({ id }) => !removed.has(id));
    state.layout.paneIds = state.layout.paneIds.filter(
      (id) => !removed.has(id),
    );
    this.save();
  }

  /**
   * Adds a message, or replaces the one with its id. A changed message must be a new object:
   * saving reuses a finished message's JSON while it is the same one. Not saved by itself;
   * callers save once a message is worth keeping, rather than on every streamed update.
   */
  putMessage(pane: PaneView, message: ConversationMessage) {
    putMessage(writable<Pane>(pane), message);
  }

  /**
   * Adds streamed text to a message still streaming, or to a tool call's output; returns the
   * message, or nothing when it is gone or finished. Not saved by itself, as `putMessage`.
   */
  append(
    pane: PaneView,
    id: string,
    field: 'text' | 'output',
    text: string,
  ): MessageView | undefined {
    return appendToMessage(writable<Pane>(pane), id, field, text);
  }
}

/** Adds a message to the pane, or replaces the one with its id. */
export function putMessage(pane: Pane, message: ConversationMessage) {
  const index = pane.messages.findLastIndex((item) => item.id === message.id);
  if (index === -1) pane.messages.push(message);
  else pane.messages[index] = message;
}

/**
 * Ends messages left streaming by a turn that was cut off: tool calls as failed, the rest
 * as complete. Returns whether any were.
 */
export function settleMessages(pane: Pane) {
  let settled = false;
  for (const message of pane.messages)
    if (message.status === 'streaming') {
      message.status = message.kind === 'tool' ? 'failed' : 'complete';
      settled = true;
    }
  return settled;
}

/** Adds text to a streaming message's text or tool output; returns the message if it took it. */
export function appendToMessage(
  pane: Pane,
  id: string,
  field: 'text' | 'output',
  text: string,
) {
  const message = pane.messages.findLast((item) => item.id === id);
  if (message?.status !== 'streaming') return;
  if (field === 'text') message.text += text;
  else if (message.tool) message.tool.output += text;
  else return;
  return message;
}

/** Projects: adding, opening, changing, and removing them with their panes. */
export class ProjectChanges {
  constructor(
    private readonly state: () => State,
    private readonly panes: PaneChanges,
    private readonly save: Save,
  ) {}

  add(project: Project): ProjectView {
    this.state().projects.push(project);
    this.save();
    return project;
  }

  update(project: ProjectView, patch: ProjectPatch) {
    assign(writable<Project>(project), patch);
    this.save();
  }

  /** Puts the project on screen. */
  open(project: ProjectView) {
    writable<Project>(project).lastOpenedAt = Date.now();
    this.state().lastProjectId = project.id;
    this.save();
  }

  /** Opens the most recently opened project, or shows none when there are none. */
  openLatest() {
    const latest = this.state().projects.toSorted(
      (first, second) => second.lastOpenedAt - first.lastOpenedAt,
    )[0];
    if (latest) return this.open(latest);
    delete this.state().lastProjectId;
    this.save();
  }

  /** Removes the project and every pane in it, archived or not. */
  remove(project: ProjectView) {
    const state = this.state();
    this.panes.remove(
      state.panes
        .filter((pane) => pane.projectId === project.id)
        .map(({ id }) => id),
    );
    state.projects = state.projects.filter((item) => item !== project);
    if (state.lastProjectId === project.id) this.openLatest();
    this.save();
  }
}

/** SSH connections. */
export class ConnectionChanges {
  constructor(
    private readonly state: () => State,
    private readonly save: Save,
  ) {}

  /** Adds the connection, or replaces the one with its id. */
  put(connection: SshConnection): ReadonlyDeep<SshConnection> {
    const { connections } = this.state();
    const index = connections.findIndex(({ id }) => id === connection.id);
    if (index === -1) connections.push(connection);
    else connections[index] = connection;
    this.save();
    return connection;
  }

  remove(id: string) {
    const state = this.state();
    state.connections = state.connections.filter(
      (connection) => connection.id !== id,
    );
    this.save();
  }
}

/** What the user set in Settings, and what the app remembers between panes. */
export class SettingChanges {
  constructor(
    private readonly state: () => State,
    private readonly save: Save,
  ) {}

  /** Replaces the stored preferences; unset ones keep their defaults. */
  setPreferences(stored: Partial<Preferences>) {
    this.state().preferences = stored;
    this.save();
  }

  /** Remembers what a turn ran with, which new panes then start with. */
  rememberTurn(
    provider: AssistantProvider,
    model: string,
    reasoningEffort: ReasoningEffort,
  ) {
    const { settings } = this.state();
    settings.lastProvider = provider;
    settings.lastReasoningEffort = reasoningEffort;
    settings.lastModels = { ...settings.lastModels, [provider]: model };
    this.save();
  }
}
