import { format } from 'node:util';
import { errorMessage } from '../../shared/domain';

/** One end of a message channel: a utility process's parent port, a MessagePort, or a test's pair. */
export type Endpoint = {
  post(message: unknown): void;
  listen(receive: (message: unknown) => void): void;
};

type Message =
  | { kind: 'call'; id: number; method: string; args: unknown[] }
  | { kind: 'result'; id: number; value: unknown }
  | { kind: 'error'; id: number; message: string }
  | { kind: 'event'; name: string; data: unknown };

/** Calls fail with this once the process at the other end has stopped. */
export class HostStopped extends Error {
  constructor(name: string) {
    super(`${name} stopped`);
    this.name = 'HostStopped';
  }
}

// Methods take whatever their side declares; `unknown[]` would refuse narrower parameters.
export type Methods = Record<string, (...args: any[]) => unknown>;

/**
 * Calls and events between two processes over one channel. Everything sent arrives in the
 * order it was sent, events and replies alike, so an event sent before a reply is handled
 * before the call resolves. A failed call rejects with the other side's error message.
 */
export class Rpc<Remote extends Methods = Methods> {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly listeners = new Map<string, (data: never) => void>();
  private failed?: Error;

  constructor(
    private readonly endpoint: Endpoint,
    private readonly handlers: Methods = {},
  ) {
    endpoint.listen((message) => this.receive(message as Message));
  }

  call<Method extends keyof Remote & string>(
    method: Method,
    ...args: Parameters<Remote[Method]>
  ): Promise<Awaited<ReturnType<Remote[Method]>>> {
    if (this.failed) return Promise.reject(this.failed);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.endpoint.post({ kind: 'call', id, method, args });
    });
  }

  emit(name: string, data?: unknown) {
    if (!this.failed) this.endpoint.post({ kind: 'event', name, data });
  }

  on<Data>(name: string, listener: (data: Data) => void) {
    this.listeners.set(name, listener as (data: never) => void);
    return this;
  }

  /** Rejects every call still waiting, and any made later, as once the other side is gone. */
  fail(error: Error) {
    this.failed = error;
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  private receive(message: Message) {
    switch (message.kind) {
      case 'call':
        return void this.answer(message);
      case 'result':
      case 'error': {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.kind === 'result') pending.resolve(message.value);
        else pending.reject(Error(message.message));
        return;
      }
      case 'event':
        return this.listeners.get(message.name)?.(message.data as never);
    }
  }

  private async answer({
    id,
    method,
    args,
  }: {
    id: number;
    method: string;
    args: unknown[];
  }) {
    try {
      const handler = this.handlers[method];
      if (!handler) throw Error(`Unknown method ${method}`);
      const value = await handler(...args);
      if (!this.failed) this.endpoint.post({ kind: 'result', id, value });
    } catch (cause) {
      if (!this.failed)
        this.endpoint.post({ kind: 'error', id, message: errorMessage(cause) });
    }
  }
}

/**
 * Sends console warnings and errors on to the other side, where the app's log file is.
 * For a utility process, whose own console only reaches the terminal it was started from.
 */
export function forwardConsole(rpc: Rpc) {
  for (const level of ['warn', 'error'] as const) {
    const write = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      write(...args);
      // Formatted as the console does, so an error keeps its stack.
      rpc.emit('log', { level, text: format(...args) });
    };
  }
}
