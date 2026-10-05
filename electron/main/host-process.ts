import {
  utilityProcess,
  type MessagePortMain,
  type UtilityProcess,
} from 'electron';
import { setTimeout as wait } from 'node:timers/promises';
import { HostStopped, Rpc, type Endpoint, type Methods } from './rpc';

/** How long a host gets to wind down on quit before it is killed. */
const CLOSE_TIMEOUT_MS = 3000;

/** What every host answers: a request to wind down before it is stopped. */
type Closable = Methods & { close(): unknown };

export type HostOptions<Remote extends Closable> = {
  /** The name the OS lists the process under. */
  name: string;
  /** The bundled entry file the process runs. */
  modulePath: string;
  /** What the host may call in main. */
  handlers?: Methods;
  /** Set up on each start, before anything else is sent: event listeners and first messages. */
  started?: (rpc: Rpc<Remote>) => void;
  /** The host stopped without being closed; it starts again on next use. */
  stopped?: (code: number) => void;
  log?: (message: string) => void;
};

/**
 * Work moved out of the main process into a utility process of its own, so that a flood of
 * output or a slow parse there can't hold up the window, and a crash there takes down only
 * that work. Main supervises it: starts it on first use, again after it stops, and closes it
 * on quit.
 */
export class HostProcess<Remote extends Closable> {
  private child?: UtilityProcess;
  private rpc?: Rpc<Remote>;
  private closing = false;

  constructor(private readonly options: HostOptions<Remote>) {}

  get running() {
    return !!this.rpc;
  }

  /** The running host's channel, started if it isn't running. */
  get(): Rpc<Remote> {
    if (this.closing) throw Error(`${this.options.name} is shutting down`);
    if (this.rpc) return this.rpc;
    const child = utilityProcess.fork(this.options.modulePath, [], {
      serviceName: this.options.name,
      stdio: 'inherit',
      cwd: process.cwd(),
      // Programs it starts run with the app's binary, as main's would.
      env: { ...process.env, BONFIRE_EXEC_PATH: process.execPath },
    });
    const listeners = new Set<(message: unknown) => void>();
    const endpoint: Endpoint = {
      post: (message) => child.postMessage(message),
      listen: (receive) => listeners.add(receive),
    };
    child.on('message', (message) => {
      for (const receive of listeners) receive(message);
    });
    const rpc = new Rpc<Remote>(endpoint, this.options.handlers);
    rpc.on<{ level: 'warn' | 'error'; text: string }>(
      'log',
      ({ level, text }) => console[level](`[${this.options.name}] ${text}`),
    );
    child.once('exit', (code) => {
      rpc.fail(new HostStopped(this.options.name));
      if (this.child !== child) return;
      this.child = undefined;
      this.rpc = undefined;
      if (this.closing) return;
      this.options.log?.(
        `${this.options.name} stopped unexpectedly (code ${code})`,
      );
      this.options.stopped?.(code);
    });
    this.child = child;
    this.rpc = rpc;
    this.options.started?.(rpc);
    return rpc;
  }

  call<Method extends keyof Remote & string>(
    method: Method,
    ...args: Parameters<Remote[Method]>
  ) {
    try {
      return this.get().call(method, ...args);
    } catch (cause) {
      return Promise.reject(cause);
    }
  }

  /** Hands the host one end of a channel, as to the window. */
  postPort(message: unknown, port: MessagePortMain) {
    this.get();
    this.child!.postMessage(message, [port]);
  }

  /** Asks the host to wind down, and kills it if it takes too long. */
  async close() {
    this.closing = true;
    const { child, rpc } = this;
    if (!child || !rpc) return;
    const exited = new Promise<void>((resolve) =>
      child.once('exit', () => resolve()),
    );
    // Every host is closable, so the channel is one to a closable host.
    const closable: Rpc<Closable> = rpc;
    await Promise.race([
      closable.call('close').catch(() => {}),
      wait(CLOSE_TIMEOUT_MS),
    ]);
    child.kill();
    await Promise.race([exited, wait(CLOSE_TIMEOUT_MS)]);
  }
}
