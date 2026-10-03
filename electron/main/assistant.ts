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
  ProviderLimits,
  Session,
  Usage,
} from '../../shared/contracts';
import {
  PROVIDER_LABELS,
  errorMessage,
  isDefaultTitle,
  titleFrom,
} from '../../shared/domain';
import { readImage, type ImageMimeType } from './attachments';
import type { Store } from './persistence';
import { MAX_TOOL_OUTPUT } from './tool-text';

export type ChooseImage = () => Promise<
  { name: string; path: string } | undefined
>;

export type PendingAttachment = Attachment & {
  paneId: string;
  path: string;
  mimeType: ImageMimeType;
  base64: string;
};

export type Turn = {
  pane: Pane;
  session: Session;
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

export function assistantMessage(
  id: string,
  kind: MessageKind,
  text: string,
  status: MessageStatus = 'complete',
): ConversationMessage {
  return { id, role: 'assistant', kind, text, status };
}

type ActiveTurn = Turn & {
  /** Whether an error for this turn has already been shown. */
  errored: boolean;
  interrupt?: () => Promise<void>;
  graceTimer?: NodeJS.Timeout;
};

/** What the renderer last received for a streaming message, to work out the next update. */
type Sent = { text: string; output: string; rest: string };

/** Shared turn lifecycle for chat providers; subclasses only translate SDK events. */
export abstract class ChatAssistant {
  protected abstract readonly provider: AssistantProvider;
  /** Everything runs unattended until there is a setting for it. */
  approvals: ApprovalMode = 'auto';
  private readonly turns = new Map<string, ActiveTurn>();
  private readonly attachments = new Map<string, PendingAttachment>();
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
  private modelCache?: { at: number; models: ModelOption[] };
  private modelRequest?: Promise<ModelOption[]>;
  private limitsCache?: { at: number; limits: ProviderLimits };
  private limitsRequest?: Promise<ProviderLimits>;

  constructor(
    private readonly store: Store,
    private readonly emit: (event: AssistantEvent) => void,
    private readonly chooseImage: ChooseImage,
  ) {}

  protected abstract run(turn: Turn): Promise<void>;
  protected abstract listModels(): Promise<ModelOption[]>;
  protected abstract readLimits(): Promise<ProviderLimits>;

  async pickAttachment(paneId: string): Promise<Attachment | null> {
    this.paneFor(paneId);
    const file = await this.chooseImage();
    if (!file) return null;
    const { size, previewUrl, mimeType, base64 } = await readImage(file.path);
    const attachment = { id: randomUUID(), name: file.name, size, previewUrl };
    this.attachments.set(attachment.id, {
      ...attachment,
      paneId,
      path: file.path,
      mimeType,
      base64,
    });
    return attachment;
  }

  async send(input: AssistantSendInput) {
    const pane = this.paneFor(input.paneId);
    const label = PROVIDER_LABELS[this.provider];
    if (this.turns.has(pane.id)) throw Error(`${label} is already responding`);
    if (!pane.sessionId) throw Error('Select a project first');
    const session = this.store.session(pane.sessionId);

    const attachments = input.attachmentIds.map((id) => {
      const attachment = this.attachments.get(id);
      if (attachment?.paneId !== pane.id)
        throw Error('Attachment is no longer available');
      return attachment;
    });

    pane.model = input.model;
    pane.reasoningEffort = input.reasoningEffort;
    if (isDefaultTitle(pane.title)) pane.title = titleFrom(input.text);
    const { settings } = this.store.state;
    settings.lastProvider = this.provider;
    settings.lastModels = {
      ...settings.lastModels,
      [this.provider]: input.model,
    };

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
      text: input.text,
      status: 'complete',
    });

    const turn: ActiveTurn = {
      pane,
      session,
      input,
      attachments,
      controller: new AbortController(),
      approvals: this.approvals,
      cancelled: false,
      errored: false,
      setInterrupt: (interrupt) => (turn.interrupt = interrupt),
    };
    this.turns.set(pane.id, turn);
    this.notify({ paneId: pane.id, type: 'status', status: 'running' });

    try {
      await this.run(turn);
    } catch (cause) {
      // A stop isn't a failure, and a failure the provider already showed isn't repeated.
      if (!turn.cancelled && !turn.controller.signal.aborted && !turn.errored)
        this.publishError(pane, errorMessage(cause));
    } finally {
      clearTimeout(turn.graceTimer);
      this.denyRequests(pane.id);
      this.settle(pane, turn.errored);
      for (const { id } of attachments) this.attachments.delete(id);
      this.turns.delete(pane.id);
      this.store.save();
      if (turn.errored)
        this.notify({ paneId: pane.id, type: 'status', status: 'failed' });
      this.notify({ paneId: pane.id, type: 'status', status: 'idle' });
    }
  }

  /** Stops the turn: interrupts the provider if it can, otherwise kills it. */
  cancel(paneId: string) {
    this.paneFor(paneId);
    const turn = this.turns.get(paneId);
    if (!turn || turn.cancelled) return;
    turn.cancelled = true;
    this.denyRequests(paneId);
    const kill = () => turn.controller.abort();
    if (!turn.interrupt) return kill();
    turn.graceTimer = setTimeout(kill, INTERRUPT_GRACE_MS);
    turn.interrupt().catch(kill);
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
    };
  }

  /** Models the provider offers. Cached briefly; a failed refresh serves the stale list. */
  models(): Promise<ModelOption[]> {
    const MODEL_TTL_MS = 60_000;
    if (this.modelCache && Date.now() - this.modelCache.at < MODEL_TTL_MS)
      return Promise.resolve(this.modelCache.models);
    this.modelRequest ??= this.listModels()
      .then((models) => {
        this.modelCache = { at: Date.now(), models };
        return models;
      })
      .catch((cause) => {
        if (this.modelCache) return this.modelCache.models;
        throw cause;
      })
      .finally(() => (this.modelRequest = undefined));
    return this.modelRequest;
  }

  /** Plan limits of the signed-in account. Cached briefly so reopening the popover is cheap. */
  limits(): Promise<ProviderLimits> {
    const LIMITS_TTL_MS = 30_000;
    if (this.limitsCache && Date.now() - this.limitsCache.at < LIMITS_TTL_MS)
      return Promise.resolve(this.limitsCache.limits);
    this.limitsRequest ??= this.readLimits()
      .then((limits) => {
        this.limitsCache = { at: Date.now(), limits };
        return limits;
      })
      .finally(() => (this.limitsRequest = undefined));
    return this.limitsRequest;
  }

  close() {
    for (const turn of this.turns.values()) turn.controller.abort();
    for (const id of [...this.requests.keys()]) this.resolveRequest(id);
    this.flush();
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
