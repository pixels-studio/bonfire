import { randomUUID } from 'node:crypto';
import type {
  ApprovalMode,
  AssistantEvent,
  AssistantProvider,
  AssistantRequest,
  AssistantRespondInput,
  AssistantSendInput,
  AssistantSnapshot,
  Attachment,
  ConversationMessage,
  ModelOption,
  Pane,
  Project,
  ProviderAccount,
  ProviderLimits,
  SignInWaiting,
  QueuedPrompt,
  Skill,
  Usage,
} from '../../shared/contracts';
import {
  PROVIDER_LABELS,
  errorMessage,
  isDefaultTitle,
  promptText,
  titleFrom,
  splitPrompt,
  withoutMarkers,
} from '../../shared/domain';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PASTE_FOLDER_PREFIX,
  PendingAttachments,
  sniffImageExtension,
  toolImagePreview,
  type PendingAttachment,
} from './attachments';
import { Cached } from './cached';
import { localMachine, type Machine } from './machines';
import type { Store } from './persistence';
import { MAX_TOOL_OUTPUT } from './tool-text';
import { sendable, type PaneView, type ProjectView } from './state';

/** Images shown from one tool result; later ones are dropped rather than crowding the reply. */
const MAX_TOOL_IMAGES = 4;

export type ChooseImage = () => Promise<
  { name: string; path: string } | undefined
>;

/** What assistants need from the app shell. */
export type AssistantHost = {
  chooseImage: ChooseImage;
  /** Opens a URL in the user's browser, such as a sign-in page. */
  openUrl: (url: string) => Promise<void>;
  /** Scales a tool result's image down for display; the agent host has no image tools of its own. */
  toolImagePreview?: (
    base64: string,
    mimeType: string,
  ) => Promise<string | undefined>;
  /** Shared between providers, so a pane keeps its attachments when its provider changes. */
  attachments?: PendingAttachments;
  /** The machine a project's folder is on, where its agent runs; this computer by default. */
  machineOf?: (project: ProjectView) => Machine;
};

export type { PendingAttachment };

/**
 * What an assistant needs of the state: lookups, and the changes a turn makes. The Store
 * provides it; so can a stand-in that passes the changes on to the Store elsewhere.
 */
export type AgentStore = Pick<
  Store,
  'preferences' | 'project' | 'pane' | 'save'
> & {
  readonly panes: Pick<Store['panes'], 'update' | 'putMessage' | 'append'>;
  readonly settings: Pick<Store['settings'], 'rememberTurn'>;
  /** A turn is over and everything it changed is saved or on its way. */
  release?(pane: PaneView): void;
};

/** A message from the user, as handed to a provider. */
export type Prompt = {
  text: string;
  attachments: PendingAttachment[];
  /** Skills to run with the message, already checked against what the provider offers. */
  skills: Skill[];
};

/** Adds a message to the running turn. */
export type Steer = (prompt: Prompt) => Promise<void>;

export type Turn = {
  pane: PaneView;
  project: ProjectView;
  /** Where the project's folder is, and so where the provider's CLI runs. */
  machine: Machine;
  input: AssistantSendInput;
  attachments: PendingAttachment[];
  /** Skills to run with the first message. */
  skills: Skill[];
  /** Hard stop: kills the provider process. */
  controller: AbortController;
  /** Whether tools run unattended or the user is asked first. */
  approvals: ApprovalMode;
  /** Set once the user asked to stop; providers then report a stop, not an error. */
  cancelled: boolean;
  /**
   * Registers a graceful way to stop the turn. Cancelling tries it first so the
   * session stays resumable, and aborts if the provider doesn't wind down.
   */
  setInterrupt(interrupt: () => Promise<void>): void;
  /**
   * Registers how to add a message to the turn while it runs, or clears it once the
   * turn can no longer take one. Without it, messages meant to steer are queued.
   */
  setSteer(steer: Steer | undefined): void;
};

/** What the user decided about a request, or `undefined` if the turn ended first. */
export type RequestAnswer =
  | { decision: 'allow' | 'allow-session' | 'deny' }
  | { answers: Record<string, string[]> };

/** A request as asked, before it is given an id. */
export type RequestInput = AssistantRequest extends infer Request
  ? Request extends unknown
    ? Omit<Request, 'id'>
    : never
  : never;

type MessageKind = ConversationMessage['kind'];
type MessageStatus = ConversationMessage['status'];

/** How long streaming updates are batched before they are sent to the renderer. */
const FLUSH_DELAY_MS = 24;
/** How long a graceful interrupt gets before the provider process is killed. */
const INTERRUPT_GRACE_MS = 5_000;
/** How long a browser sign-in may take before it is given up. */
const LOGIN_TIMEOUT_MS = 3 * 60_000;
/** How long generating a short text, such as a title, may take. */
const GENERATE_TIMEOUT_MS = 60_000;
/** How long a project's skill list is reused; skills change only when files on disk do. */
const SKILLS_TTL_MS = 60_000;
/** Matches a provider's way of saying its model is overloaded or rate-limited, across vendors. */
const CAPACITY_PATTERN =
  /\b(at capacity|overloaded|rate.?limit|too many requests|try again later|temporarily unavailable)\b/i;

export function assistantMessage(
  id: string,
  kind: MessageKind,
  text: string,
  status: MessageStatus = 'complete',
): ConversationMessage {
  return { id, role: 'assistant', kind, text, status };
}

/** Labels pasted text so the model can tell it apart from the message itself. */
export function attachedText({ name, text }: { name: string; text: string }) {
  return `<attachment name="${name}">\n${text}\n</attachment>`;
}

/**
 * A prompt's text and attachments in the order the user placed them. An attachment
 * without a marker in the text comes after it.
 */
export function inlineParts<T extends { id: string }>(
  text: string,
  attachments: T[],
): ({ text: string } | { attachment: T })[] {
  const used = new Set<string>();
  const parts: ({ text: string } | { attachment: T })[] = [];
  for (const part of splitPrompt(text)) {
    if ('text' in part) {
      parts.push(part);
      continue;
    }
    const attachment = attachments.find(({ id }) => id === part.attachmentId);
    if (attachment && !used.has(attachment.id)) {
      used.add(attachment.id);
      parts.push({ attachment });
    }
  }
  for (const attachment of attachments)
    if (!used.has(attachment.id)) parts.push({ attachment });
  return parts;
}

type ActiveTurn = Turn & {
  /** Whether an error for this turn has already been shown. */
  errored: boolean;
  interrupt?: () => Promise<void>;
  steer?: Steer;
  graceTimer?: NodeJS.Timeout;
};

/** A follow-up waiting for the running turn to end. */
type Queued = { id: string; input: AssistantSendInput; skills: Skill[] };

/** What the renderer last received for a streaming message, to work out the next update. */
type Sent = { text: string; output: string; rest: string };

/** Shared turn lifecycle for chat providers; subclasses only translate SDK events. */
export abstract class ChatAssistant {
  protected abstract readonly provider: AssistantProvider;
  private readonly turns = new Map<string, ActiveTurn>();
  private readonly queues = new Map<string, Queued[]>();
  private readonly requests = new Map<
    string,
    {
      paneId: string;
      request: AssistantRequest;
      resolve: (answer: RequestAnswer | undefined) => void;
    }
  >();
  /** Messages changed since the last flush, in the order they first changed. */
  private readonly dirty = new Map<
    string,
    { pane: PaneView; message: ConversationMessage }
  >();
  private readonly sent = new Map<string, Sent>();
  private flushTimer?: NodeJS.Timeout;
  private readonly modelList = new Cached(() => this.listModels(), 60_000, {
    serveStale: true,
  });
  private readonly planLimits = new Cached(() => this.readLimits(), 30_000);
  private readonly signedInAccount = new Cached(
    () => this.readAccount(),
    60_000,
  );
  /** Skill lists by project id. */
  private readonly skillLists = new Map<string, Cached<Skill[]>>();
  /** A sign-in in progress: aborting its controller cancels it, even while it waits for a code. */
  private login?: { controller: AbortController; timeout: NodeJS.Timeout };
  private readonly attachments: PendingAttachments;

  constructor(
    protected readonly store: AgentStore,
    private readonly emit: (event: AssistantEvent) => void,
    protected readonly host: AssistantHost,
  ) {
    this.attachments = host.attachments ?? new PendingAttachments();
  }

  protected abstract run(turn: Turn): Promise<void>;
  protected abstract listModels(): Promise<ModelOption[]>;
  /** Skills the provider can run in the project's folder, on the machine it is on. */
  protected abstract listSkills(
    project: ProjectView,
    machine: Machine,
  ): Promise<Skill[]>;
  protected abstract readLimits(): Promise<ProviderLimits>;
  protected abstract readAccount(): Promise<ProviderAccount>;
  /**
   * Signs in through the browser on `machine`; rejects if `signal` aborts first. A machine
   * this can't finish itself, such as one reached over SSH, asks for the browser's code, or
   * shows its own, next.
   */
  protected abstract signIn(
    signal: AbortSignal,
    machine: Machine,
  ): Promise<void | SignInWaiting>;
  /**
   * Finishes a sign-in that asked for the code the browser showed. Only providers whose
   * `signIn` can ask for one need to override this.
   */
  protected provideSignInCode(
    _code: string,
    _signal: AbortSignal,
  ): Promise<void> {
    throw Error('This provider does not need a sign-in code.');
  }
  /**
   * Waits out a sign-in that showed its own code to enter elsewhere. Only providers whose
   * `signIn` can show one need to override this.
   */
  protected awaitDeviceSignIn(_signal: AbortSignal): Promise<void> {
    throw Error('This provider has no sign-in to wait for.');
  }
  /** One-off completion without tools or conversation history. */
  protected abstract complete(
    prompt: string,
    model: string,
    signal: AbortSignal,
  ): Promise<string>;

  async pickAttachment(paneId: string): Promise<Attachment | null> {
    this.paneFor(paneId);
    const file = await this.host.chooseImage();
    return file ? this.attachments.addImage(paneId, file) : null;
  }

  /** Attaches an image from disk, e.g. one dropped onto the pane. */
  async attachFile(paneId: string, path: string): Promise<Attachment> {
    this.paneFor(paneId);
    if (!/\.(png|jpe?g|webp|gif)$/i.test(path))
      throw Error('Only PNG, JPEG, WebP and GIF images can be attached');
    return this.attachments.addImage(paneId, {
      name: path.split(/[\\/]/).pop() ?? path,
      path,
    });
  }

  /** Attaches image data with no file behind it, such as a pasted screenshot. */
  async attachImage(
    paneId: string,
    name: string,
    data: Uint8Array,
  ): Promise<Attachment> {
    this.paneFor(paneId);
    const type = sniffImageExtension(data);
    if (!type)
      throw Error('Only PNG, JPEG, WebP and GIF images can be attached');
    // Providers read images from disk, so the data needs a file.
    const dir = await mkdtemp(join(tmpdir(), PASTE_FOLDER_PREFIX));
    const base = name.replace(/\.[^.]*$/, '').replace(/[\\/]/g, '_') || 'Image';
    const path = join(dir, `${base}.${type}`);
    await writeFile(path, data);
    return this.attachments.addImage(paneId, { name: `${base}.${type}`, path });
  }

  /** Holds pasted text as an attachment, so a long paste doesn't flood the message. */
  attachText(paneId: string, text: string, name?: string): Attachment {
    this.paneFor(paneId);
    return this.attachments.addText(paneId, text, name);
  }

  /**
   * Starts a turn and resolves when it ends. While a turn runs, a message marked as a
   * follow-up steers it or waits in the queue; any other message is refused.
   */
  async send(input: AssistantSendInput) {
    const pane = this.paneFor(input.paneId);
    // Looked up before the running turn is, so nothing can start a turn in between.
    const skills = input.skills.length
      ? await this.skillsFor(pane, input.skills)
      : [];
    const turn = this.turns.get(pane.id);
    if (!turn) return this.start(pane, input, skills);
    if (!input.followUp)
      throw Error(`${PROVIDER_LABELS[this.provider]} is already responding`);
    // A turn that can't take a message yet, or is winding down, gets it next instead.
    if (input.followUp === 'steer' && turn.steer && !turn.cancelled)
      return this.steerTurn(turn, turn.steer, input, skills);
    this.enqueue(pane, input, skills);
  }

  /** Sends a queued message now: it steers the running turn, or starts the next one. */
  async sendQueued(paneId: string, queuedId: string) {
    const turn = this.turns.get(paneId);
    if (turn && (!turn.steer || turn.cancelled))
      throw Error('This response cannot take a message right now.');
    const input = this.takeQueued(paneId, queuedId);
    await this.send({ ...input, followUp: 'steer' });
  }

  unqueue(paneId: string, queuedId: string) {
    const input = this.takeQueued(paneId, queuedId);
    this.attachments.delete(input.attachmentIds);
  }

  /** Stops the turn: interrupts the provider if it can, otherwise kills it. Queued messages stay. */
  cancel(paneId: string) {
    this.paneFor(paneId);
    const turn = this.turns.get(paneId);
    if (!turn || turn.cancelled) return;
    turn.cancelled = true;
    turn.steer = undefined;
    this.denyRequests(paneId);
    const kill = () => turn.controller.abort();
    if (!turn.interrupt) return kill();
    turn.graceTimer = setTimeout(kill, INTERRUPT_GRACE_MS);
    turn.interrupt().catch(kill);
  }

  /** Stops the pane for good, dropping its queue and unsent attachments. */
  discard(paneId: string) {
    this.cancel(paneId);
    this.queues.delete(paneId);
    this.attachments.discard(paneId);
  }

  /** Whether a turn is running in the pane. */
  isRunning(paneId: string) {
    return this.turns.has(paneId);
  }

  /** Delivers the user's answer to a pending request; late answers are ignored. */
  respond({ paneId, requestId, decision, answers }: AssistantRespondInput) {
    const pending = this.requests.get(requestId);
    if (pending?.paneId !== paneId) return;
    const answer = answers ? { answers } : decision && { decision };
    if (!answer) throw Error('A response needs a decision or answers');
    this.resolveRequest(requestId, answer);
  }

  /** The current state of a pane, for a renderer that mounted after events were sent. */
  snapshot(paneId: string): AssistantSnapshot {
    const pane = this.paneFor(paneId);
    // Anything still batched is already in `pane`, so it must not be sent again afterwards.
    this.flush();
    return {
      running: this.turns.has(paneId),
      messages: sendable<ConversationMessage[]>(pane.messages),
      usage: pane.usage,
      requests: [...this.requests.values()]
        .filter((pending) => pending.paneId === paneId)
        .map((pending) => pending.request),
      queue: this.queueOf(paneId),
    };
  }

  /** Models the provider offers. Cached briefly; a failed refresh serves the stale list. */
  models(): Promise<ModelOption[]> {
    return this.modelList.get();
  }

  /** Skills the pane's provider can run in its project. Cached briefly; a failed refresh serves the stale list. */
  skills(paneId: string): Promise<Skill[]> {
    const pane = this.paneFor(paneId);
    if (!pane.projectId) return Promise.resolve([]);
    const project = this.store.project(pane.projectId);
    let list = this.skillLists.get(project.id);
    if (!list) {
      list = new Cached(
        () =>
          this.listSkills(
            project,
            this.host.machineOf?.(project) ?? localMachine,
          ),
        SKILLS_TTL_MS,
        { serveStale: true },
      );
      this.skillLists.set(project.id, list);
    }
    return list.get();
  }

  /** Plan limits of the signed-in account. Cached briefly so reopening the popover is cheap. */
  limits(): Promise<ProviderLimits> {
    return this.planLimits.get();
  }

  account(): Promise<ProviderAccount> {
    return this.signedInAccount.get();
  }

  /**
   * Signs in through the browser on `machine` (this computer by default), replacing any
   * earlier attempt. Resolves with the new account, or says a code from the browser is
   * needed next if `machine` can't catch the browser's redirect itself.
   */
  async connect(
    machine: Machine = localMachine,
  ): Promise<ProviderAccount | SignInWaiting> {
    this.login?.controller.abort();
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, LOGIN_TIMEOUT_MS);
    const login = { controller, timeout };
    this.login = login;
    let result: void | SignInWaiting;
    try {
      result = await this.signIn(controller.signal, machine);
    } catch (cause) {
      clearTimeout(timeout);
      if (this.login === login) this.login = undefined;
      if (timedOut)
        throw Error(
          `${PROVIDER_LABELS[this.provider]} sign-in timed out. Try again.`,
        );
      throw cause;
    }
    if (result) return result;
    return this.finishConnect(login);
  }

  /** Clears what's cached from the previous account and reads the one just signed into. */
  private finishConnect(login: {
    controller: AbortController;
    timeout: NodeJS.Timeout;
  }): Promise<ProviderAccount> {
    clearTimeout(login.timeout);
    if (this.login === login) this.login = undefined;
    this.signedInAccount.clear();
    this.planLimits.clear();
    this.modelList.clear();
    return this.account();
  }

  /** Finishes a sign-in `connect` said needed a code, with the one the browser showed. */
  async submitSignInCode(code: string): Promise<ProviderAccount> {
    const login = this.login;
    if (!login) throw Error('No sign-in is waiting for a code.');
    try {
      await this.provideSignInCode(code, login.controller.signal);
    } catch (cause) {
      clearTimeout(login.timeout);
      if (this.login === login) this.login = undefined;
      throw cause;
    }
    return this.finishConnect(login);
  }

  /** Waits out a sign-in `connect` said was showing its own code, until it's entered. */
  async awaitSignIn(): Promise<ProviderAccount> {
    const login = this.login;
    if (!login) throw Error('No sign-in is in progress.');
    try {
      await this.awaitDeviceSignIn(login.controller.signal);
    } catch (cause) {
      clearTimeout(login.timeout);
      if (this.login === login) this.login = undefined;
      throw cause;
    }
    return this.finishConnect(login);
  }

  cancelConnect() {
    this.login?.controller.abort();
  }

  /** Generates a short text, such as a title, with the given model. */
  async generate(prompt: string, model: string): Promise<string> {
    const signal = AbortSignal.timeout(GENERATE_TIMEOUT_MS);
    return (await this.complete(prompt, model, signal)).trim();
  }

  close() {
    this.login?.controller.abort();
    for (const turn of this.turns.values()) turn.controller.abort();
    for (const id of [...this.requests.keys()]) this.resolveRequest(id);
    this.flush();
  }

  private async start(
    pane: PaneView,
    input: AssistantSendInput,
    skills: Skill[],
  ) {
    if (!pane.projectId) throw Error('Select a project first');
    const project = this.store.project(pane.projectId);
    const attachments = this.attachmentsFor(pane, input.attachmentIds);
    const shown = withoutMarkers(promptText(input.text, skills));

    this.store.panes.update(pane, {
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      fastMode: input.fastMode,
      approvals: input.approvals,
      ...(isDefaultTitle(pane.title) && { title: titleFrom(shown) }),
    });
    this.store.settings.rememberTurn(
      this.provider,
      input.model,
      input.reasoningEffort,
    );
    this.publishPrompt(pane, { text: input.text, attachments, skills });

    const turn: ActiveTurn = {
      pane,
      project,
      machine: this.host.machineOf?.(project) ?? localMachine,
      input,
      attachments,
      skills,
      controller: new AbortController(),
      approvals: input.approvals,
      cancelled: false,
      errored: false,
      setInterrupt: (interrupt) => (turn.interrupt = interrupt),
      setSteer: (steer) => (turn.steer = steer),
    };
    this.turns.set(pane.id, turn);
    this.notify({ paneId: pane.id, type: 'status', status: 'running' });

    try {
      await this.settleFastMode(turn);
      // Stopped while it was being set up: the provider never starts.
      if (!turn.controller.signal.aborted) await this.run(turn);
    } catch (cause) {
      // A stop isn't a failure, and a failure the provider already showed isn't repeated.
      if (!turn.cancelled && !turn.controller.signal.aborted && !turn.errored)
        this.publishError(pane, errorMessage(cause));
    } finally {
      clearTimeout(turn.graceTimer);
      this.denyRequests(pane.id);
      this.settle(pane, turn.errored);
      this.attachments.delete(attachments.map(({ id }) => id));
      this.turns.delete(pane.id);
      this.store.save(pane);
      if (turn.errored)
        this.notify({ paneId: pane.id, type: 'status', status: 'failed' });
      else if (!turn.cancelled)
        this.notify({ paneId: pane.id, type: 'status', status: 'completed' });
      this.notify({ paneId: pane.id, type: 'status', status: 'idle' });
      this.store.release?.(pane);
      // After a stop or a failure the queue waits, so the user decides what runs next.
      if (!turn.errored && !turn.cancelled) this.startNext(pane);
    }
  }

  /**
   * Fast mode only applies to models that support it, so a request for it on any
   * other is dropped here, before the run, and what the pane remembers matches.
   */
  private async settleFastMode(turn: ActiveTurn) {
    if (!turn.input.fastMode) return;
    const models = await this.modelList.get().catch(() => []);
    const supported = models.find(
      ({ value }) => value === turn.input.model,
    )?.supportsFast;
    if (supported) return;
    turn.input = { ...turn.input, fastMode: false };
    this.store.panes.update(turn.pane, { fastMode: false });
  }

  private async steerTurn(
    turn: ActiveTurn,
    steer: Steer,
    input: AssistantSendInput,
    skills: Skill[],
  ) {
    const attachments = this.attachmentsFor(turn.pane, input.attachmentIds);
    const prompt = { text: input.text, attachments, skills };
    await steer(prompt);
    this.publishPrompt(turn.pane, prompt);
    this.attachments.delete(attachments.map(({ id }) => id));
  }

  private enqueue(pane: PaneView, input: AssistantSendInput, skills: Skill[]) {
    // Checked now, so a bad attachment is reported to the sender rather than lost later.
    this.attachmentsFor(pane, input.attachmentIds);
    const queue = this.queues.get(pane.id) ?? [];
    queue.push({ id: randomUUID(), input, skills });
    this.queues.set(pane.id, queue);
    this.notifyQueue(pane.id);
  }

  private startNext(pane: PaneView) {
    const next = this.queues.get(pane.id)?.shift();
    if (!next) return;
    this.notifyQueue(pane.id);
    // Nobody awaits a queued message, so a failure to start is shown in the pane.
    this.start(pane, next.input, next.skills).catch((cause) =>
      this.publishError(pane, errorMessage(cause)),
    );
  }

  private takeQueued(paneId: string, queuedId: string) {
    this.paneFor(paneId);
    const queue = this.queues.get(paneId) ?? [];
    const index = queue.findIndex((item) => item.id === queuedId);
    if (index === -1) throw Error('That message is no longer queued');
    const [{ input }] = queue.splice(index, 1);
    this.notifyQueue(paneId);
    return input;
  }

  private queueOf(paneId: string): QueuedPrompt[] {
    return (this.queues.get(paneId) ?? []).map(({ id, input, skills }) => ({
      id,
      text: withoutMarkers(promptText(input.text, skills)),
      attachments: input.attachmentIds.length,
    }));
  }

  private notifyQueue(paneId: string) {
    this.notify({ paneId, type: 'queue', queue: this.queueOf(paneId) });
  }

  private attachmentsFor(pane: PaneView, ids: string[]) {
    return this.attachments.get(pane.id, ids);
  }

  /** The named skills, refused if the provider no longer offers one. */
  private async skillsFor(pane: PaneView, names: string[]): Promise<Skill[]> {
    if (!names.length) return [];
    const offered = await this.skills(pane.id);
    return [...new Set(names)].map((name) => {
      const skill = offered.find((item) => item.name === name);
      if (!skill) throw Error(`The /${name} skill is no longer available`);
      return skill;
    });
  }

  private publishPrompt(pane: PaneView, { text, attachments, skills }: Prompt) {
    for (const { id, name, size, previewUrl } of attachments)
      this.publish(pane, {
        id,
        role: 'user',
        kind: 'attachment',
        text: name,
        status: 'complete',
        size,
        previewUrl,
      });
    this.publish(pane, {
      id: randomUUID(),
      role: 'user',
      kind: 'text',
      text: promptText(text, skills),
      status: 'complete',
    });
  }

  /**
   * Inserts or replaces a message, optionally persisting, and notifies the renderer. A
   * changed message must be a new object: saving reuses a finished message's JSON while it
   * is the same one.
   */
  protected publish(
    pane: PaneView,
    message: ConversationMessage,
    persist = true,
  ) {
    this.store.panes.putMessage(pane, message);
    if (persist) this.store.save(pane);
    this.markDirty(pane, message);
    // Outside a turn, as for a late update or a failure to start, nothing will release it.
    if (!this.turns.has(pane.id)) {
      this.flush();
      this.store.release?.(pane);
    }
    // Finished messages go out at once; streaming ones are batched.
    if (message.status !== 'streaming') this.flush();
  }

  /**
   * Appends streamed text to a message's `text`, or to a tool call's output.
   * Ignored unless the message is still streaming, so late deltas can't alter a finished one.
   */
  protected append(
    pane: PaneView,
    id: string,
    field: 'text' | 'output',
    text: string,
  ) {
    if (!text) return;
    const current = pane.messages.findLast((item) => item.id === id);
    // Past the cap the rest is dropped; the finished message carries a clipped copy.
    if (
      field === 'output' &&
      (current?.tool?.output.length ?? 0) >= MAX_TOOL_OUTPUT
    )
      return;
    const message = this.store.panes.append(pane, id, field, text);
    if (message) this.markDirty(pane, message);
  }

  /**
   * Adds previews of a tool result's images to its message once they're ready. Runs after
   * the message with its text is already published, so a slow preview never holds up the
   * stream; `id` is looked up again rather than captured, in case the message changed meanwhile.
   */
  protected async attachToolImages(
    pane: PaneView,
    id: string,
    images: { data: string; mimeType: string }[],
  ) {
    if (!images.length) return;
    const previews = (
      await Promise.all(
        images
          .slice(0, MAX_TOOL_IMAGES)
          .map(({ data, mimeType }) =>
            (this.host.toolImagePreview ?? toolImagePreview)(data, mimeType),
          ),
      )
    ).filter((preview): preview is string => !!preview);
    if (!previews.length) return;
    const current = pane.messages.findLast((item) => item.id === id);
    if (!current?.tool) return;
    this.publish(pane, {
      ...current,
      tool: { ...current.tool, images: previews },
    });
  }

  protected publishError(pane: PaneView, text: string) {
    const turn = this.turns.get(pane.id);
    if (turn) turn.errored = true;
    const kind = CAPACITY_PATTERN.test(text) ? 'capacity' : 'error';
    this.publish(pane, assistantMessage(randomUUID(), kind, text, 'failed'));
  }

  protected publishUsage(pane: PaneView, usage: Usage) {
    this.store.panes.update(pane, { usage });
    this.notify({ paneId: pane.id, type: 'usage', usage });
  }

  protected rememberThread(pane: PaneView, threadId: string) {
    if (pane.threadId !== threadId) this.store.panes.update(pane, { threadId });
  }

  /**
   * Asks the user and waits. Resolves `undefined` if the turn ends or is
   * cancelled first, which callers should treat as a refusal.
   */
  protected ask(
    pane: PaneView,
    request: RequestInput,
  ): Promise<RequestAnswer | undefined> {
    const full = { ...request, id: randomUUID() } as AssistantRequest;
    return new Promise((resolve) => {
      this.requests.set(full.id, { paneId: pane.id, request: full, resolve });
      this.notify({ paneId: pane.id, type: 'request', request: full });
    });
  }

  private resolveRequest(requestId: string, answer?: RequestAnswer) {
    const pending = this.requests.get(requestId);
    if (!pending) return;
    this.requests.delete(requestId);
    this.notify({
      paneId: pending.paneId,
      type: 'request-resolved',
      requestId,
    });
    pending.resolve(answer);
  }

  private denyRequests(paneId: string) {
    for (const [requestId, pending] of this.requests)
      if (pending.paneId === paneId) this.resolveRequest(requestId);
  }

  /** Marks whatever the turn left mid-flight as finished, so nothing keeps shimmering. */
  private settle(pane: PaneView, failed: boolean) {
    for (const message of pane.messages) {
      if (message.status !== 'streaming') continue;
      const next: MessageStatus =
        message.kind === 'tool' && failed ? 'failed' : 'complete';
      this.publish(pane, { ...message, status: next }, false);
    }
  }

  /** Sends an event that isn't a message update, after any batched updates so order holds. */
  private notify(event: AssistantEvent) {
    this.flush();
    this.emit(event);
  }

  private markDirty(pane: PaneView, message: ConversationMessage) {
    this.dirty.set(`${pane.id}:${message.id}`, { pane, message });
    this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_DELAY_MS);
  }

  private flush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    const batch = [...this.dirty];
    this.dirty.clear();
    for (const [key, { pane, message }] of batch)
      this.emitMessage(key, pane.id, message);
  }

  /**
   * Streaming messages that only grew since the last send go out as deltas, so a
   * long reply doesn't cost its whole text on every update.
   */
  private emitMessage(
    key: string,
    paneId: string,
    message: ConversationMessage,
  ) {
    if (message.status !== 'streaming') {
      this.sent.delete(key);
      this.emit({ paneId, type: 'message', message });
      return;
    }
    const next: Sent = {
      text: message.text,
      output: message.tool?.output ?? '',
      rest: JSON.stringify({
        ...message,
        text: '',
        tool: message.tool && { ...message.tool, output: '' },
      }),
    };
    const previous = this.sent.get(key);
    this.sent.set(key, next);
    const grew =
      previous?.rest === next.rest &&
      next.text.startsWith(previous.text) &&
      next.output.startsWith(previous.output);
    if (!grew) {
      this.emit({ paneId, type: 'message', message });
      return;
    }
    const { id } = message;
    const text = next.text.slice(previous.text.length);
    const output = next.output.slice(previous.output.length);
    if (text) this.emit({ paneId, type: 'delta', id, field: 'text', text });
    if (output)
      this.emit({ paneId, type: 'delta', id, field: 'output', text: output });
  }

  private paneFor(paneId: string) {
    const pane = this.store.pane(paneId);
    if (pane.type !== this.provider)
      throw Error(
        `This pane is not a ${PROVIDER_LABELS[this.provider]} assistant`,
      );
    return pane;
  }
}
