import { randomUUID } from 'node:crypto';
import type {
  AssistantEvent,
  AssistantSnapshot,
  ConversationMessage,
} from '../../shared/contracts';
import { assistantMessage } from './assistant';
import { agentState, type AgentChange } from './agent-store';
import type { AgentMethods } from './agent-worker';
import type { Store } from './persistence';
import { HostStopped, type Methods, type Rpc } from './rpc';
import { sendable, type PaneView } from './state';

/** The agent host as main supervises it; a HostProcess, or a stand-in in tests. */
export type AgentHostHandle = {
  readonly running: boolean;
  call<Method extends keyof AgentMethods & string>(
    method: Method,
    ...args: Parameters<AgentMethods[Method]>
  ): Promise<Awaited<ReturnType<AgentMethods[Method]>>>;
  close(): Promise<void>;
};

export type AgentHostSetup = {
  /** What the host may call in main. */
  handlers: Methods;
  /** Called as the host starts, before anything else is sent to it. */
  started: (rpc: Rpc<AgentMethods>) => void;
  /** The host stopped without being asked to. */
  stopped: () => void;
};

/** Shown in each pane whose turn the agent host took down with it. */
export const AGENT_HOST_STOPPED =
  'The agent process stopped unexpectedly. Send your message again to carry on.';

/**
 * Main's side of the agent host. It keeps the host's copy of the state current, makes the
 * changes the host reports in the Store, and keeps each conversation as its events stream
 * past on their way to the window. It also knows, from those events, which panes are mid-turn
 * and what they wait on, so that a host that stops leaves no pane looking busy.
 */
export class AgentClient {
  private readonly host: AgentHostHandle;
  private readonly running = new Set<string>();
  /** Requests waiting on the user, by id, with their pane. */
  private readonly requests = new Map<string, string>();
  /** Panes with messages queued in the host. */
  private readonly queued = new Set<string>();
  /** The last of the host's changes made here, which the next copy of the state includes. */
  private applied = 0;
  /** Whether the host's copy of the state is behind main's. */
  private stale = false;
  /** Whether the host has changes made here that it hasn't been told of. */
  private unconfirmed = false;
  /** Set while a change from the host is made, which its copy has already. */
  private applying = false;
  private syncQueued = false;
  /** Panes whose turn the host took down, which were told so. */
  private readonly ended = new Set<string>();

  constructor(
    private readonly store: Store,
    /** Passes an event on to the window and whatever else follows turns. */
    private readonly emit: (event: AssistantEvent) => void,
    handlers: Methods,
    connect: (setup: AgentHostSetup) => AgentHostHandle,
  ) {
    this.host = connect({
      handlers,
      started: (rpc) => this.started(rpc),
      stopped: () => this.stopped(),
    });
    // Conversations aren't in the host's copy, and the host's own changes are in it already.
    store.onChange((pane) => {
      if (pane || this.applying) return;
      this.stale = true;
      this.syncSoon();
    });
  }

  isRunning(paneId: string) {
    return this.running.has(paneId);
  }

  /** Calls the host, which is started if it isn't running, once it has the latest state. */
  call<Method extends keyof AgentMethods & string>(
    method: Method,
    ...args: Parameters<AgentMethods[Method]>
  ) {
    this.syncNow();
    return this.host.call(method, ...args);
  }

  /**
   * Starts a turn and resolves when it ends. A turn the host took down was reported in its
   * pane; a message it took down before its turn began is refused here instead.
   */
  async send(...args: Parameters<AgentMethods['send']>) {
    try {
      await this.call('send', ...args);
    } catch (cause) {
      if (!(cause instanceof HostStopped)) throw cause;
      if (this.ended.has(args[0].paneId)) return;
      throw Error(AGENT_HOST_STOPPED);
    }
  }

  /** The pane as the window should show it: the conversation here, the rest from the host. */
  async snapshot(paneId: string): Promise<AssistantSnapshot> {
    const pane = this.store.pane(paneId);
    // Only a running host can have a turn underway, and never in a closed pane, which the
    // host no longer knows; one that isn't running needn't start for this.
    const live =
      this.host.running && !pane.archived
        ? await this.call('snapshot', paneId)
        : { running: false, requests: [], queue: [] };
    // Events the host sent before its answer have been applied by now.
    return {
      ...live,
      messages: sendable<ConversationMessage[]>(pane.messages),
      usage: pane.usage,
    };
  }

  /** Stops the pane's agent for good: its turn, queue and unsent attachments. */
  discard(paneId: string) {
    if (this.host.running) this.call('discard', paneId).catch(() => {});
  }

  close() {
    return this.host.close();
  }

  private started(rpc: Rpc<AgentMethods>) {
    rpc.on<AssistantEvent>('event', (event) => this.received(event));
    rpc.on<AgentChange>('change', (change) => this.changed(change));
    // A new host has made no changes yet.
    this.applied = 0;
    this.stale = false;
    this.unconfirmed = false;
    this.ended.clear();
    void rpc
      .call('sync', agentState(this.store.state), this.applied)
      .catch(() => {});
  }

  /** Coalesces the copies a burst of changes would send into one. */
  private syncSoon() {
    if (this.syncQueued || !this.host.running) return;
    this.syncQueued = true;
    queueMicrotask(() => this.syncNow());
  }

  /**
   * Sends the host the state if main changed it, which also confirms the host's changes; if
   * only the host did, it is told they are made, without a copy of what it has already.
   */
  private syncNow() {
    this.syncQueued = false;
    if (!this.host.running) return;
    if (this.stale) {
      this.stale = this.unconfirmed = false;
      this.host
        .call('sync', agentState(this.store.state), this.applied)
        .catch(() => {});
    } else if (this.unconfirmed) {
      this.unconfirmed = false;
      this.host.call('confirm', this.applied).catch(() => {});
    }
  }

  private paneOf(paneId?: string) {
    return paneId === undefined
      ? undefined
      : this.store.state.panes.find(({ id }) => id === paneId);
  }

  /** Keeps the conversation as the event changes it, notes what it says of the turn, and passes it on. */
  private received(event: AssistantEvent) {
    const pane = this.paneOf(event.paneId);
    // A pane removed meanwhile, with its project, has nothing left to show the event in.
    if (!pane) return;
    switch (event.type) {
      case 'message':
        this.store.panes.putMessage(pane, event.message);
        break;
      case 'delta':
        this.store.panes.append(pane, event.id, event.field, event.text);
        break;
      case 'status':
        if (event.status === 'running') this.running.add(pane.id);
        else if (event.status === 'idle') this.running.delete(pane.id);
        break;
      case 'request':
        this.requests.set(event.request.id, pane.id);
        break;
      case 'request-resolved':
        this.requests.delete(event.requestId);
        break;
      case 'queue':
        if (event.queue.length) this.queued.add(pane.id);
        else this.queued.delete(pane.id);
        break;
    }
    this.emit(event);
  }

  private changed(change: AgentChange) {
    this.applied = change.seq;
    if (change.kind === 'save')
      return this.store.save(this.paneOf(change.paneId));
    this.applying = true;
    try {
      if (change.kind === 'turn')
        this.store.settings.rememberTurn(
          change.provider,
          change.model,
          change.reasoningEffort,
        );
      else {
        const pane = this.paneOf(change.paneId);
        if (pane) this.store.panes.update(pane, change.patch);
        // The host keeps its pane changes until told they are made.
        this.unconfirmed = true;
        this.syncSoon();
      }
    } finally {
      this.applying = false;
    }
  }

  /** Settles what the host left mid-turn, so no pane waits on it forever. */
  private stopped() {
    for (const [requestId, paneId] of this.requests)
      this.emit({ paneId, type: 'request-resolved', requestId });
    for (const paneId of this.queued)
      this.emit({ paneId, type: 'queue', queue: [] });
    for (const paneId of this.running) {
      const pane = this.paneOf(paneId);
      if (pane) this.endTurn(pane);
      this.ended.add(paneId);
    }
    this.requests.clear();
    this.queued.clear();
    this.running.clear();
  }

  private endTurn(pane: PaneView) {
    for (const message of pane.messages) {
      if (message.status !== 'streaming') continue;
      this.publish(pane, {
        ...message,
        status: message.kind === 'tool' ? 'failed' : 'complete',
      });
    }
    this.publish(
      pane,
      assistantMessage(randomUUID(), 'error', AGENT_HOST_STOPPED, 'failed'),
    );
    this.store.save(pane);
    this.emit({ paneId: pane.id, type: 'status', status: 'failed' });
    this.emit({ paneId: pane.id, type: 'status', status: 'idle' });
  }

  private publish(pane: PaneView, message: ConversationMessage) {
    this.store.panes.putMessage(pane, message);
    this.emit({ paneId: pane.id, type: 'message', message });
  }
}
