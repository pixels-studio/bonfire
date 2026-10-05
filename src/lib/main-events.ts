import type { AssistantEvent, TerminalEvent } from '$shared/contracts';

type Listener<Event> = (event: Event) => void;

/**
 * One subscription to a channel from main, handed out to listeners by key. Each listener the
 * bridge calls gets its own copy of the event, so with a subscription per pane every update
 * was copied once for each open pane, only for all but one to drop it.
 */
export class Dispatcher<Event> {
  private readonly keyed = new Map<string, Set<Listener<Event>>>();
  private readonly everything = new Set<Listener<Event>>();
  private unsubscribe?: () => void;

  constructor(
    private readonly subscribe: (listener: Listener<Event>) => () => void,
    private readonly keyOf: (event: Event) => string,
  ) {}

  /** Calls `listener` with the events for `key`; returns what stops it. */
  on(key: string, listener: Listener<Event>) {
    const listeners = this.keyed.get(key) ?? new Set();
    this.keyed.set(key, listeners);
    return this.add(listeners, listener, () => {
      if (!listeners.size && this.keyed.get(key) === listeners)
        this.keyed.delete(key);
    });
  }

  /** Calls `listener` with every event; returns what stops it. */
  onAll(listener: Listener<Event>) {
    return this.add(this.everything, listener);
  }

  private add(
    listeners: Set<Listener<Event>>,
    listener: Listener<Event>,
    emptied?: () => void,
  ) {
    // A listener added twice is still one listener, so each gets its own entry.
    const entry: Listener<Event> = (event) => listener(event);
    listeners.add(entry);
    this.unsubscribe ??= this.subscribe(this.dispatch);
    return () => {
      if (!listeners.delete(entry)) return;
      emptied?.();
      if (!this.everything.size && !this.keyed.size) {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
      }
    };
  }

  private readonly dispatch = (event: Event) => {
    for (const listener of [...this.everything]) listener(event);
    const listeners = this.keyed.get(this.keyOf(event));
    if (listeners) for (const listener of [...listeners]) listener(event);
  };
}

export const assistantEvents = new Dispatcher<AssistantEvent>(
  (listener) => window.bonfire.assistant.onEvent(listener),
  (event) => event.paneId,
);

export const terminalEvents = new Dispatcher<TerminalEvent>(
  (listener) => window.bonfire.terminal.onData(listener),
  (event) => event.terminalId,
);
