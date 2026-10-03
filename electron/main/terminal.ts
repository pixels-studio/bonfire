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

const SCROLLBACK_BYTES = 1024 * 1024;

type TerminalRecord = TerminalSnapshot & {
  paneId: string;
  projectId: string;
  type: TerminalCreateInput['type'];
  process: pty.IPty;
};

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
    const record: TerminalRecord = {
      ...owner,
      process,
      sequence: 0,
      data: '',
    };
    this.records.set(id, record);
    process.onData((data) => {
      record.data = (record.data + data).slice(-SCROLLBACK_BYTES);
      this.emit({ terminalId: id, sequence: ++record.sequence, data });
    });
    process.onExit(({ exitCode }) => {
      record.exitCode = exitCode;
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
