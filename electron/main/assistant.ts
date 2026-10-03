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
  QueuedPrompt,
  Usage,
} from '../../shared/contracts';
import {
  PROVIDER_LABELS,
  errorMessage,
  isDefaultTitle,
  titleFrom,
} from '../../shared/domain';
import { PendingAttachments, type PendingAttachment } from './attachments';
import { Cached } from './cached';
import { localMachine, type Machine } from './machines';
import type { Store } from './persistence';
import { MAX_TOOL_OUTPUT } from './tool-text';

export type ChooseImage = () => Promise<
  { name: string; path: string } | undefined
>;

/** What assistants need from the app shell. */
export type AssistantHost = {
  chooseImage: ChooseImage;
  /** Opens a URL in the user's browser, such as a sign-in page. */
  openUrl: (url: string) => Promise<void>;
  /** Shared between providers, so a pane keeps its attachments when its provider changes. */
  attachments?: PendingAttachments;
  /** The machine a project's folder is on, where its agent runs; this computer by default. */
  machineOf?: (project: Project) => Machine;
};

export type { PendingAttachment };

/** A message from the user, as handed to a provider. */
export type Prompt = { text: string; attachments: PendingAttachment[] };

/** Adds a message to the running turn. */
export type Steer = (prompt: Prompt) => Promise<void>;

export type Turn = {
  pane: Pane;
  project: Project;
  /** Where the project's folder is, and so where the provider's CLI runs. */
  machine: Machine;
  input: AssistantSendInput;
  attachments: PendingAttachment[];
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

type ActiveTurn = Turn & {
  /** Whether an error for this turn has already been shown. */
  errored: boolean;
  interrupt?: () => Promise<void>;
  steer?: Steer;
  graceTimer?: NodeJS.Timeout;
};

/** A follow-up waiting for the running turn to end. */
type Queued = { id: string; input: AssistantSendInput };

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
    { pane: Pane; message: ConversationMessage }
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
  private login?: AbortController;
  private readonly attachments: PendingAttachments;

  constructor(
    protected readonly store: Store,
    private readonly emit: (event: AssistantEvent) => void,
    protected readonly host: AssistantHost,
  ) {
    this.attachments = host.attachments ?? new PendingAttachments();
  }

  protected abstract run(turn: Turn): Promise<void>;
  protected abstract listModels(): Promise<ModelOption[]>;
  protected abstract readLimits(): Promise<ProviderLimits>;
  protected abstract readAccount(): Promise<ProviderAccount>;
  /** Signs in through the browser; rejects if `signal` aborts first. */
  protected abstract signIn(signal: AbortSignal): Promise<void>;
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

  /** Holds pasted text as an attachment, so a long paste doesn't flood the message. */
  attachText(paneId: string, text: string): Attachment {
    this.paneFor(paneId);
    return this.attachments.addText(paneId, text);
  }

  /**
   * Starts a turn and resolves when it ends. While a turn runs, a message marked as a
   * follow-up steers it or waits in the queue; any other message is refused.
   */
  async send(input: AssistantSendInput) {
    const pane = this.paneFor(input.paneId);
    const turn = this.turns.get(pane.id);
    if (!turn) return this.start(pane, input);
    if (!input.followUp)
      throw Error(`${PROVIDER_LABELS[this.provider]} is already responding`);
    // A turn that can't take a message yet, or is winding down, gets it next instead.
    if (input.followUp === 'steer' && turn.steer && !turn.cancelled)
      return this.steerTurn(turn, turn.steer, input);
    this.enqueue(pane, input);
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
      messages: pane.messages,
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

  /** Plan limits of the signed-in account. Cached briefly so reopening the popover is cheap. */
  limits(): Promise<ProviderLimits> {
    return this.planLimits.get();
  }

  account(): Promise<ProviderAccount> {
    return this.signedInAccount.get();
  }

  /** Signs in through the browser, replacing any earlier attempt, and returns the new account. */
  async connect(): Promise<ProviderAccount> {
    this.login?.abort();
    const login = new AbortController();
    this.login = login;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      login.abort();
    }, LOGIN_TIMEOUT_MS);
    try {
      await this.signIn(login.signal);
    } catch (cause) {
      if (timedOut)
        throw Error(
          `${PROVIDER_LABELS[this.provider]} sign-in timed out. Try again.`,
        );
      throw cause;
    } finally {
      clearTimeout(timeout);
      if (this.login === login) this.login = undefined;
    }
    // Everything cached belonged to the previous account.
    this.signedInAccount.clear();
    this.planLimits.clear();
    this.modelList.clear();
    return this.account();
  }

  cancelConnect() {
    this.login?.abort();
  }

  /** Generates a short text, such as a title, with the given model. */
  async generate(prompt: string, model: string): Promise<string> {
    const signal = AbortSignal.timeout(GENERATE_TIMEOUT_MS);
    return (await this.complete(prompt, model, signal)).trim();
  }

  close() {
    this.login?.abort();
    for (const turn of this.turns.values()) turn.controller.abort();
    for (const id of [...this.requests.keys()]) this.resolveRequest(id);
    this.flush();
  }

  private async start(pane: Pane, input: AssistantSendInput) {
    if (!pane.projectId) throw Error('Select a project first');
    const project = this.store.project(pane.projectId);
    const attachments = this.attachmentsFor(pane, input.attachmentIds);

    pane.model = input.model;
    pane.reasoningEffort = input.reasoningEffort;
    pane.fastMode = input.fastMode;
    pane.approvals = input.approvals;
    if (isDefaultTitle(pane.title)) pane.title = titleFrom(input.text);
    const { settings } = this.store.state;
    settings.lastProvider = this.provider;
    settings.lastModels = {
      ...settings.lastModels,
      [this.provider]: input.model,
    };
    this.publishPrompt(pane, { text: input.text, attachments });

    const turn: ActiveTurn = {
      pane,
      project,
      machine: this.host.machineOf?.(project) ?? localMachine,
      input,
      attachments,
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
      await this.run(turn);
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
      this.store.save();
      if (turn.errored)
        this.notify({ paneId: pane.id, type: 'status', status: 'failed' });
      else if (!turn.cancelled)
        this.notify({ paneId: pane.id, type: 'status', status: 'completed' });
      this.notify({ paneId: pane.id, type: 'status', status: 'idle' });
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
    turn.pane.fastMode = false;
  }

  private async steerTurn(
    turn: ActiveTurn,
    steer: Steer,
    input: AssistantSendInput,
  ) {
    const attachments = this.attachmentsFor(turn.pane, input.attachmentIds);
    const prompt = { text: input.text, attachments };
    await steer(prompt);
    this.publishPrompt(turn.pane, prompt);
    this.attachments.delete(attachments.map(({ id }) => id));
  }

  private enqueue(pane: Pane, input: AssistantSendInput) {
    // Checked now, so a bad attachment is reported to the sender rather than lost later.
    this.attachmentsFor(pane, input.attachmentIds);
    const queue = this.queues.get(pane.id) ?? [];
    queue.push({ id: randomUUID(), input });
    this.queues.set(pane.id, queue);
    this.notifyQueue(pane.id);
  }

  private startNext(pane: Pane) {
    const next = this.queues.get(pane.id)?.shift();
    if (!next) return;
    this.notifyQueue(pane.id);
    // Nobody awaits a queued message, so a failure to start is shown in the pane.
    this.start(pane, next.input).catch((cause) =>
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
    return (this.queues.get(paneId) ?? []).map(({ id, input }) => ({
      id,
      text: input.text,
      attachments: input.attachmentIds.length,
    }));
  }

  private notifyQueue(paneId: string) {
    this.notify({ paneId, type: 'queue', queue: this.queueOf(paneId) });
  }

  private attachmentsFor(pane: Pane, ids: string[]) {
    return this.attachments.get(pane.id, ids);
  }

  private publishPrompt(pane: Pane, { text, attachments }: Prompt) {
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
      text,
      status: 'complete',
    });
  }

  /** Inserts or replaces a message, optionally persisting, and notifies the renderer. */
  protected publish(pane: Pane, message: ConversationMessage, persist = true) {
    const index = pane.messages.findLastIndex((item) => item.id === message.id);
    if (index === -1) pane.messages.push(message);
    else pane.messages[index] = message;
    if (persist) this.store.save();
    this.markDirty(pane, message);
    // Finished messages go out at once; streaming ones are batched.
    if (message.status !== 'streaming') this.flush();
  }

  /**
   * Appends streamed text to a message's `text`, or to a tool call's output.
   * Ignored unless the message is still streaming, so late deltas can't alter a finished one.
   */
  protected append(
    pane: Pane,
    id: string,
    field: 'text' | 'output',
    text: string,
  ) {
    const message = pane.messages.findLast((item) => item.id === id);
    if (message?.status !== 'streaming' || !text) return;
    if (field === 'text') message.text += text;
    else if (message.tool) {
      // Past the cap the rest is dropped; the finished message carries a clipped copy.
      if (message.tool.output.length >= MAX_TOOL_OUTPUT) return;
      message.tool.output += text;
    } else return;
    this.markDirty(pane, message);
  }

  protected publishError(pane: Pane, text: string) {
    const turn = this.turns.get(pane.id);
    if (turn) turn.errored = true;
    this.publish(pane, assistantMessage(randomUUID(), 'error', text, 'failed'));
  }

  protected publishUsage(pane: Pane, usage: Usage) {
    pane.usage = usage;
    this.store.save();
    this.notify({ paneId: pane.id, type: 'usage', usage });
  }

  protected rememberThread(pane: Pane, threadId: string) {
    if (pane.threadId === threadId) return;
    pane.threadId = threadId;
    this.store.save();
  }

  /**
   * Asks the user and waits. Resolves `undefined` if the turn ends or is
   * cancelled first, which callers should treat as a refusal.
   */
  protected ask(
    pane: Pane,
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
  private settle(pane: Pane, failed: boolean) {
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

  private markDirty(pane: Pane, message: ConversationMessage) {
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
