import * as pty from 'node-pty';
import { randomUUID } from 'node:crypto';
import type {
  TerminalCreateInput,
  TerminalEvent,
  TerminalSnapshot,
} from '../../shared/contracts';
import { isAssistantPane } from '../../shared/domain';
import type { Machine, Program } from './machines';
import type { Store } from './persistence';
import { defaultShell, isWindows } from './shell';

const SCROLLBACK_BYTES = 1024 * 1024;
/** How long a stopped script gets to exit after Ctrl-C before it is hung up on. */
const STOP_GRACE_MS = 3000;

type TerminalRecord = TerminalSnapshot & {
  paneId: string;
  projectId: string;
  /** `script` runs a project's run script rather than a shell or CLI. */
  type: TerminalCreateInput['type'] | 'script';
  process: pty.IPty;
  /** Settles once the process has exited. */
  exited: Promise<void>;
};

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

export class Terminals {
  private readonly records = new Map<string, TerminalRecord>();

  constructor(
    private readonly store: Store,
    private readonly emit: (event: TerminalEvent) => void,
    /** The machine the project's folder is on. */
    private readonly machine: (projectId: string) => Machine,
  ) {}

  /**
   * Starts a PTY for the pane, or returns its running one. Any pane may run a
   * shell; an agent pane may also run its provider's CLI.
   */
  create({ projectId, paneId, type }: TerminalCreateInput) {
    const project = this.store.project(projectId);
    const pane = this.store.pane(paneId);
    const cli = isAssistantPane(pane) ? pane.type : undefined;
    if (pane.projectId !== project.id || (type !== 'shell' && type !== cli))
      throw Error('Pane/project mismatch');

    const owner = { projectId: project.id, paneId, type };
    const running = this.find(
      (record) =>
        record.paneId === owner.paneId &&
        record.type === owner.type &&
        record.exitCode === undefined,
    );
    if (running) return running;

    const machine = this.machine(project.id);
    return this.spawn(
      owner,
      type === 'shell' ? machine.shell() : { file: type, args: [] },
      project.path,
    );
  }

  /**
   * Runs a command in the pane's terminal. Whatever it ran before is stopped first and
   * waited for, so a restarted server finds its port free.
   */
  async run(projectId: string, paneId: string, command: string) {
    const project = this.store.project(projectId);
    const previous = [...this.records].filter(
      ([, record]) => record.paneId === paneId,
    );
    await Promise.all(previous.map(([id]) => this.stop(id)));
    for (const [id] of previous) this.records.delete(id);
    return this.spawn(
      { projectId: project.id, paneId, type: 'script' },
      scriptProgram(this.machine(project.id), command),
      project.path,
    );
  }

  /**
   * Ends a terminal's process the way a person would: Ctrl-C, so servers shut down cleanly,
   * then a hang-up if it is still running after a moment. Its output stays on screen.
   */
  async stop(id: string) {
    const record = this.get(id);
    if (record.exitCode !== undefined) return;
    record.process.write('\x03');
    let timer: NodeJS.Timeout | undefined;
    const grace = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, STOP_GRACE_MS);
    });
    await Promise.race([record.exited, grace]);
    clearTimeout(timer);
    this.kill(id);
  }

  private find(matches: (record: TerminalRecord) => boolean) {
    for (const [id, record] of this.records) if (matches(record)) return id;
  }

  private spawn(
    owner: Pick<TerminalRecord, 'projectId' | 'paneId' | 'type'>,
    program: Program,
    cwd: string,
  ) {
    const command = this.machine(owner.projectId).terminal(program, { cwd });
    let process: pty.IPty;
    try {
      process = pty.spawn(command.file, command.args, {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: command.cwd,
        env: command.env,
      });
    } catch (cause) {
      throw Error(
        `Could not launch ${command.file}. Install the CLI and ensure it is on PATH. ${String(cause)}`,
      );
    }

    const id = randomUUID();
    let markExited!: () => void;
    const record: TerminalRecord = {
      ...owner,
      process,
      sequence: 0,
      data: '',
      exited: new Promise((resolve) => (markExited = resolve)),
    };
    this.records.set(id, record);
    process.onData((data) => {
      record.data = (record.data + data).slice(-SCROLLBACK_BYTES);
      this.emit({ terminalId: id, sequence: ++record.sequence, data });
    });
    process.onExit(({ exitCode }) => {
      record.exitCode = exitCode;
      markExited();
      this.emit({ terminalId: id, sequence: ++record.sequence, exitCode });
    });
    return id;
  }

  snapshot(id: string): TerminalSnapshot {
    const { data, sequence, exitCode } = this.get(id);
    return { data, sequence, exitCode };
  }

  write(id: string, data: string) {
    const record = this.get(id);
    if (record.exitCode === undefined) record.process.write(data);
  }

  resize(id: string, cols: number, rows: number) {
    const record = this.get(id);
    if (record.exitCode === undefined) record.process.resize(cols, rows);
  }

  closeProject(projectId: string) {
    this.closeWhere((record) => record.projectId === projectId);
  }

  /** Ends the pane's terminals; their scrollback goes with them. */
  closePane(paneId: string) {
    this.closeWhere((record) => record.paneId === paneId);
  }

  private closeWhere(matches: (record: TerminalRecord) => boolean) {
    for (const [id, record] of this.records)
      if (matches(record)) {
        this.kill(id);
        this.records.delete(id);
      }
  }

  close() {
    for (const id of this.records.keys()) this.kill(id);
  }

  private get(id: string) {
    const record = this.records.get(id);
    if (!record) throw Error('Terminal not found');
    return record;
  }

  private kill(id: string) {
    const record = this.get(id);
    if (record.exitCode === undefined) record.process.kill();
  }
}
