import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  stateSchema,
  type ConversationMessage,
  type Pane,
  type Preferences,
  type State,
} from '../../shared/contracts';
import {
  emptyState,
  errorMessage,
  isViewPaneType,
  resolvePreferences,
} from '../../shared/domain';

/**
 * How long writes are held back so a burst of changes costs one write. Each write
 * serializes a whole conversation on the main process, so a busy agent with a long one
 * must not trigger it many times a second.
 */
const SAVE_DELAY_MS = 1000;
/** How long a save that failed waits before it is tried again. */
const RETRY_DELAY_MS = 5000;
/** Serializing slower than this is logged, since it holds up everything else in the main process. */
const SLOW_SERIALIZE_MS = 200;
/** Windows refuses a rename while another program, such as a virus scanner, has the file open. */
const RENAME_ATTEMPTS = 5;
const RENAME_RETRY_MS = 20;
const BUSY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const CONVERSATION_SUFFIX = '.json';
/** A copy of the state from before conversations moved to their own files. */
const LEGACY_BACKUP = 'state.before-conversations.json';

/** Everything one save puts on disk, serialized up front so the state may change meanwhile. */
type Batch = {
  conversations: { pane: Pane; file: string; data: string; count: number }[];
  state: string;
  /** Conversation files of panes since removed. */
  stale: string[];
  generation: number;
};

/**
 * Atomically persisted application state; lookups throw when an id is unknown.
 *
 * Conversations are most of the data and grow without bound, so each pane's messages live
 * in their own file under `conversations/`, and `state.json` holds everything else. A save
 * rewrites `state.json`, which stays small, and only the conversations that changed, so a
 * busy agent costs its own conversation rather than every chat ever had.
 *
 * Scheduled saves write in the background: only serializing runs on the main process,
 * while the disk is waited on asynchronously. On Windows a virus scanner reads every file
 * as it is written, and writing several busy conversations in step held the main process,
 * and with it the window, for seconds at a time. Saves are debounced, so call `flush()`
 * before the process exits.
 */
export class Store {
  state: State;
  private readonly file: string;
  private readonly conversations: string;
  private saveTimer?: NodeJS.Timeout;
  /** The background write underway, if any; the next one queues behind it. */
  private writing?: Promise<void>;
  /** Stepped by a write on this thread, which a background write still underway then yields to. */
  private generation = 0;
  /** Panes whose messages changed since they were last written. */
  private readonly dirty = new Set<Pane>();
  /** Panes a background write is carrying, so a write on this thread covers them too. */
  private readonly inFlight = new Set<Pane>();
  /** How many messages each pane's file held when written, to catch a change nobody reported. */
  private readonly written = new Map<string, number>();

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.file = join(directory, 'state.json');
    this.conversations = join(directory, 'conversations');
    mkdirSync(this.conversations, { recursive: true });
    const raw = existsSync(this.file)
      ? migrate(JSON.parse(readFileSync(this.file, 'utf8')))
      : undefined;
    // Versions before conversations had their own files keep them inline, and still do if
    // run again after this one. Inline messages are then the latest; an empty list is
    // only the default those versions write, so the file's copy stands.
    const inline = new Set(
      (raw?.panes ?? [])
        .filter((pane) => pane.messages?.length)
        .map(({ id }) => id),
    );
    if (inline.size) this.backUpLegacyState();
    for (const pane of raw?.panes ?? [])
      if (!inline.has(pane.id)) pane.messages = this.readConversation(pane.id);
    this.state = raw ? stateSchema.parse(raw) : emptyState();
    for (const pane of this.state.panes)
      if (inline.has(pane.id)) this.dirty.add(pane);
      else this.written.set(pane.id, pane.messages.length);
    for (const pane of settleInterrupted(this.state)) this.dirty.add(pane);
    settleProjects(this.state);
    settleLayout(this.state);
    this.pruneConversations();
    if (this.dirty.size) this.save();
  }

  /**
   * Schedules a write; changes made before it fires share it. Pass the pane whose
   * messages changed so its conversation is rewritten too.
   */
  save(pane?: Pane) {
    if (pane) this.dirty.add(pane);
    this.saveTimer ??= setTimeout(() => this.flushLater(), SAVE_DELAY_MS);
  }

  /**
   * Writes any pending changes now, on this thread; throws if they could not be written.
   * For quitting and tests. A background write underway yields: what it carries is
   * written here, and it stops short of putting its older copy over this one.
   */
  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.generation++;
    for (const pane of this.inFlight) this.dirty.add(pane);
    this.inFlight.clear();
    const batch = this.serialize();
    try {
      for (const { file, data } of batch.conversations)
        writeAtomicallySync(file, data);
      writeAtomicallySync(this.file, batch.state);
    } catch (cause) {
      this.keep(batch);
      throw cause;
    }
    for (const id of batch.stale)
      rmSync(this.conversationFile(id), { force: true });
    this.commit(batch);
  }

  /** Settles once no background write is underway; one that failed is retried, not reported here. */
  settled(): Promise<void> {
    return this.writing ?? Promise.resolve();
  }

  /**
   * A scheduled save, written in the background, one at a time. One that fails, as on
   * Windows while a scanner holds a file, is tried again later rather than thrown from a
   * timer, where it would bring up an error dialog and lose the changes.
   */
  private flushLater() {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const run: Promise<void> = (this.writing ?? Promise.resolve())
      .then(() => this.writeInBackground())
      .catch((cause) => {
        console.warn(`Could not save state: ${errorMessage(cause)}`);
        this.saveTimer ??= setTimeout(() => this.flushLater(), RETRY_DELAY_MS);
      })
      .finally(() => {
        if (this.writing === run) this.writing = undefined;
      });
    this.writing = run;
  }

  private async writeInBackground() {
    const batch = this.serialize();
    for (const { pane } of batch.conversations) this.inFlight.add(pane);
    // A write on this thread meanwhile has already put everything here on disk.
    const wanted = () => batch.generation === this.generation;
    try {
      // Conversations are written before the state that lists them, so a crash in between
      // leaves at worst an unlisted file, which the next save removes.
      for (const { file, data } of batch.conversations)
        await writeAtomically(file, data, wanted);
      if (!wanted()) return;
      await writeAtomically(this.file, batch.state, wanted);
      if (!wanted()) return;
      for (const id of batch.stale)
        await rm(this.conversationFile(id), { force: true });
      this.commit(batch);
    } catch (cause) {
      if (wanted()) this.keep(batch);
      throw cause;
    } finally {
      for (const { pane } of batch.conversations) this.inFlight.delete(pane);
    }
  }

  /** Serializes what a save puts on disk and takes the changes as written; `keep` gives them back. */
  private serialize(): Batch {
    const started = Date.now();
    const live = new Set<string>();
    const conversations: Batch['conversations'] = [];
    for (const pane of this.state.panes) {
      live.add(pane.id);
      if (
        this.dirty.has(pane) ||
        this.written.get(pane.id) !== pane.messages.length
      )
        conversations.push({
          pane,
          file: this.conversationFile(pane.id),
          data: JSON.stringify(pane.messages),
          count: pane.messages.length,
        });
    }
    this.dirty.clear();
    const panes = this.state.panes.map(({ messages: _, ...pane }) => pane);
    const batch = {
      conversations,
      state: JSON.stringify({ ...this.state, panes }),
      stale: [...this.written.keys()].filter((id) => !live.has(id)),
      generation: this.generation,
    };
    const took = Date.now() - started;
    if (took >= SLOW_SERIALIZE_MS)
      console.warn(
        `Serializing state took ${took} ms (${conversations.length} of ${this.state.panes.length} conversations)`,
      );
    return batch;
  }

  /** A write that failed leaves its changes pending, so the retry carries them. */
  private keep(batch: Batch) {
    for (const { pane } of batch.conversations) this.dirty.add(pane);
  }

  private commit(batch: Batch) {
    for (const { pane, count } of batch.conversations)
      this.written.set(pane.id, count);
    for (const id of batch.stale) this.written.delete(id);
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

  /** Removes conversation files no pane lists, such as those left by a crash mid-save. */
  private pruneConversations() {
    const live = new Set(this.state.panes.map(({ id }) => id));
    for (const name of readdirSync(this.conversations)) {
      const id = name.slice(0, -CONVERSATION_SUFFIX.length);
      if (name.endsWith(CONVERSATION_SUFFIX) && !live.has(id))
        rmSync(this.conversationFile(id), { force: true });
    }
  }

  /** Keeps the state as an older version left it, once, before it is split up. */
  private backUpLegacyState() {
    const backup = join(dirname(this.file), LEGACY_BACKUP);
    if (!existsSync(backup)) copyFileSync(this.file, backup);
  }

  private conversationFile(id: string) {
    return join(this.conversations, `${id}${CONVERSATION_SUFFIX}`);
  }

  private readConversation(id: string): ConversationMessage[] {
    try {
      return JSON.parse(readFileSync(this.conversationFile(id), 'utf8'));
    } catch {
      return [];
    }
  }
}

/** Replaces the file in one step, so a crash mid-write never leaves it half written. */
function writeAtomicallySync(file: string, data: string) {
  const temporaryFile = `${file}.now.tmp`;
  writeFileSync(temporaryFile, data, { mode: 0o600 });
  for (let attempt = 1; ; attempt++) {
    try {
      return renameSync(temporaryFile, file);
    } catch (cause) {
      if (attempt >= RENAME_ATTEMPTS || !busy(cause)) throw cause;
      sleep(RENAME_RETRY_MS * attempt);
    }
  }
}

/**
 * The background counterpart, which waits on the disk rather than holding the thread. Its
 * temporary file is its own, so a write on the thread meanwhile can't cross it, and the
 * rename is skipped once `wanted` says a newer copy is on disk already.
 */
async function writeAtomically(
  file: string,
  data: string,
  wanted: () => boolean,
) {
  const temporaryFile = `${file}.tmp`;
  await writeFile(temporaryFile, data, { mode: 0o600 });
  if (!wanted()) return rm(temporaryFile, { force: true });
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename(temporaryFile, file);
    } catch (cause) {
      if (attempt >= RENAME_ATTEMPTS || !busy(cause)) throw cause;
      await new Promise((resolve) =>
        setTimeout(resolve, RENAME_RETRY_MS * attempt),
      );
    }
  }
}

/** Whether a failure is Windows refusing a file another program holds, which passes. */
function busy(cause: unknown) {
  return BUSY_CODES.has((cause as NodeJS.ErrnoException).code ?? '');
}

function sleep(milliseconds: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/** Turns that were cut off by a crash or quit leave messages that would look busy forever. */
function settleInterrupted(state: State) {
  const settled = new Set<Pane>();
  for (const pane of state.panes)
    for (const message of pane.messages)
      if (message.status === 'streaming') {
        message.status = message.kind === 'tool' ? 'failed' : 'complete';
        settled.add(pane);
      }
  return settled;
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

/**
 * The layout lists only panes that are open; older versions left closed ones in it. They
 * also allowed several of a view pane, of which a project now keeps the first.
 */
export function settleLayout(state: State) {
  const seen = new Set<string>();
  for (const id of state.layout.paneIds) {
    const pane = state.panes.find((item) => item.id === id);
    if (!pane || pane.archived || !isViewPaneType(pane.type)) continue;
    const key = `${pane.projectId}:${pane.type}`;
    if (seen.has(key)) pane.archived = true;
    seen.add(key);
  }
  const open = new Set(
    state.panes.filter((pane) => !pane.archived).map(({ id }) => id),
  );
  state.layout.paneIds = state.layout.paneIds.filter((id) => open.has(id));
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
