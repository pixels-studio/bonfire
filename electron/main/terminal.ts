import type { MessagePortMain } from 'electron';
import type {
  TerminalCreateInput,
  TerminalEvent,
} from '../../shared/contracts';
import { isAssistantPane } from '../../shared/domain';
import { HostProcess } from './host-process';
import type { Machine, Program } from './machines';
import type { Store } from './persistence';
import type { PtyHost } from './pty-host';
import { defaultShell, isWindows } from './shell';

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
  | 'closeProject'
  | 'close'
>;

/** Whose a terminal the host runs is. */
type Known = { paneId: string; projectId: string; type: string };

/** The exit code a terminal reports when the terminal host stopped under it. */
const HOST_STOPPED_EXIT_CODE = -1;

/**
 * Runs a command through the user's shell, so their PATH and version managers apply. Over
 * SSH, the remote login shell wraps it already.
 */
function scriptProgram(machine: Machine, command: string): Program {
  if (machine.remote) return { file: 'sh', args: ['-c', command] };
  if (isWindows())
    return { file: defaultShell(), args: ['-NoLogo', '-Command', command] };
  // Interactive as well as login, as tools like nvm are often set up only in the rc file.
  return { file: defaultShell(), args: ['-ilc', command] };
}

type TerminalOptions = {
  store: Store;
  /** The machine the project's folder is on. */
  machine: (projectId: string) => Machine;
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
 * main checks each request against the projects and panes, works out the command for the
 * project's machine, and supervises the host.
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
  async create({ projectId, paneId, type }: TerminalCreateInput) {
    const { store } = this.options;
    const project = store.project(projectId);
    const pane = store.pane(paneId);
    const cli = isAssistantPane(pane) ? pane.type : undefined;
    if (pane.projectId !== project.id || (type !== 'shell' && type !== cli))
      throw Error('Pane/project mismatch');
    const machine = this.options.machine(project.id);
    const program =
      type === 'shell' ? machine.shell() : { file: type, args: [] };
    const owner = { projectId: project.id, paneId, type };
    const id = await this.call(
      'create',
      owner,
      machine.terminal(program, { cwd: project.path }),
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
   * Runs a command in the pane's terminal. Whatever it ran before is stopped first and
   * waited for, so a restarted server finds its port free.
   */
  async run(projectId: string, paneId: string, command: string) {
    const project = this.options.store.project(projectId);
    const machine = this.options.machine(project.id);
    const owner = { projectId: project.id, paneId, type: 'script' as const };
    const id = await this.call(
      'run',
      owner,
      machine.terminal(scriptProgram(machine, command), { cwd: project.path }),
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

  closeProject(projectId: string) {
    this.forget((known) => known.projectId === projectId);
    this.whenRunning('closeProject', projectId);
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
  private whenRunning(method: 'closePane' | 'closeProject', id: string) {
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
