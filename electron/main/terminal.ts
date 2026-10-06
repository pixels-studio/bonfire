import type { MessagePortMain } from 'electron';
import type {
  TerminalCreateInput,
  TerminalEvent,
} from '../../shared/contracts';
import { isAssistantPane } from '../../shared/domain';
import { HostProcess } from './host-process';
import { resolvePlace, scriptProgram, type Place } from './machines';
import type { Store } from './persistence';
import type { PtyHost } from './pty-host';

/** The terminal host's methods, as main calls them. */
type PtyMethods = Pick<
  PtyHost,
  | 'create'
  | 'run'
  | 'stop'
  | 'snapshot'
  | 'ack'
  | 'write'
  | 'resize'
  | 'closePane'
  | 'closeWorkspace'
  | 'close'
>;

/** Whose a terminal the host runs is. */
type Known = { paneId: string; workspaceId: string; type: string };

/** The exit code a terminal reports when the terminal host stopped under it. */
const HOST_STOPPED_EXIT_CODE = -1;

type TerminalOptions = {
  store: Store;
  /** The workspace's folder, on its machine. */
  folder: (workspaceId: string) => Place;
  /** The bundled terminal host. */
  modulePath: string;
  /** A terminal's process ended. */
  exited: (event: TerminalEvent) => void;
  /** Tells the window of an exit it can't hear from the terminal host, which has stopped. */
  toWindow: (event: TerminalEvent) => void;
  /** Opens a channel between the window and the terminal host, which starts the host. */
  connectWindow: () => void;
  log?: (message: string) => void;
};

/**
 * The terminals, as main sees them. Their processes and output live in the terminal host;
 * main checks each request against the workspaces and panes, works out the command for the
 * workspace's machine, and supervises the host.
 */
export class Terminals {
  private readonly host: HostProcess<PtyMethods>;
  /** The terminals the host runs, so their views can be told if it stops. */
  private readonly known = new Map<string, Known>();

  constructor(private readonly options: TerminalOptions) {
    this.host = new HostProcess<PtyMethods>({
      name: 'Bonfire Terminals',
      modulePath: options.modulePath,
      log: options.log,
      started: (rpc) => rpc.on<TerminalEvent>('exit', options.exited),
      stopped: () => this.hostStopped(),
    });
  }

  /**
   * Starts a PTY for the pane, or returns its running one. Any pane may run a
   * shell; an agent pane may also run its provider's CLI.
   */
  async create({ workspaceId, paneId, type }: TerminalCreateInput) {
    const pane = this.options.store.pane(paneId);
    const cli = isAssistantPane(pane) ? pane.type : undefined;
    if (pane.workspaceId !== workspaceId || (type !== 'shell' && type !== cli))
      throw Error('Pane/workspace mismatch');
    const { machine, path } = resolvePlace(this.options.folder(workspaceId));
    const program =
      type === 'shell' ? machine.shell() : { file: type, args: [] };
    const owner = { workspaceId, paneId, type };
    const id = await this.call(
      'create',
      owner,
      machine.terminal(program, { cwd: path }),
    );
    // A relaunch replaces the pane's terminal of that kind, which the host has let go.
    this.forget(
      (known, knownId) =>
        knownId !== id && known.paneId === paneId && known.type === type,
    );
    this.known.set(id, owner);
    return id;
  }

  /**
   * Runs a command in the pane's terminal, in the workspace's folder with `env` added.
   * Whatever it ran before is stopped first and waited for, so a restarted server finds its
   * port free.
   */
  async run(
    workspaceId: string,
    paneId: string,
    command: string,
    env?: Record<string, string>,
  ) {
    const { machine, path } = resolvePlace(this.options.folder(workspaceId));
    const owner = { workspaceId, paneId, type: 'script' as const };
    const id = await this.call(
      'run',
      owner,
      machine.terminal(scriptProgram(machine, command), { cwd: path, env }),
    );
    this.forget((known) => known.paneId === paneId);
    this.known.set(id, owner);
    return id;
  }

  /** Ends a terminal's process: Ctrl-C, then a hang-up. Its output stays on screen. */
  stop(id: string) {
    return this.call('stop', id);
  }

  snapshot(id: string) {
    return this.call('snapshot', id);
  }

  ack(id: string, chars: number) {
    return this.call('ack', id, chars);
  }

  write(id: string, data: string) {
    return this.call('write', id, data);
  }

  resize(id: string, cols: number, rows: number) {
    return this.call('resize', id, cols, rows);
  }

  /** Ends every terminal of the workspace. */
  closeWorkspace(workspaceId: string) {
    this.forget((known) => known.workspaceId === workspaceId);
    this.whenRunning('closeWorkspace', workspaceId);
  }

  /** Ends the pane's terminals; their scrollback goes with them. */
  closePane(paneId: string) {
    this.forget((known) => known.paneId === paneId);
    this.whenRunning('closePane', paneId);
  }

  /** Whether the terminal host runs; until a terminal is asked for, it doesn't. */
  get running() {
    return this.host.running;
  }

  /** Gives the window its own channel to the terminal host, for output and typing. */
  attachWindow(port: MessagePortMain) {
    this.host.postPort({ kind: 'window' }, port);
  }

  close() {
    return this.host.close();
  }

  /** Something only a running host has to do; one that isn't running has no terminals. */
  private whenRunning(method: 'closePane' | 'closeWorkspace', id: string) {
    if (this.host.running) this.host.call(method, id).catch(() => {});
  }

  private forget(matches: (known: Known, id: string) => boolean) {
    for (const [id, known] of this.known)
      if (matches(known, id)) this.known.delete(id);
  }

  /** Every terminal ended with the host; their views and run scripts hear so. */
  private hostStopped() {
    for (const terminalId of this.known.keys()) {
      const event: TerminalEvent = {
        terminalId,
        sequence: 0,
        exitCode: HOST_STOPPED_EXIT_CODE,
        hostStopped: true,
      };
      this.options.toWindow(event);
      this.options.exited(event);
    }
    this.known.clear();
  }

  /**
   * Calls the terminal host. One that isn't running starts with a channel to the window, so
   * the terminals it runs reach their views; after a crash, that waits for the next request,
   * which keeps a host that fails as it starts from restarting in a loop.
   */
  private call<Method extends keyof PtyMethods & string>(
    method: Method,
    ...args: Parameters<PtyMethods[Method]>
  ) {
    if (!this.host.running) this.options.connectWindow();
    return this.host.call(method, ...args);
  }
}
