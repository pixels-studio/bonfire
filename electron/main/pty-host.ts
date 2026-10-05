import { randomUUID } from 'node:crypto';
import type {
  TerminalCreateInput,
  TerminalEvent,
  TerminalSnapshot,
} from '../../shared/contracts';
import type { TerminalCommand } from './machines';
import { OutputFlow } from './terminal-flow';

const SCROLLBACK_BYTES = 1024 * 1024;
/** Scrollback may run this far past its cap before it is trimmed, so output isn't copied per chunk. */
const SCROLLBACK_SLACK = SCROLLBACK_BYTES / 4;
/**
 * How long output is gathered before it is sent to the window. A busy program writes
 * thousands of small chunks a second; batching them, as VS Code does, keeps the window
 * from handling each one, at a delay too short to notice while typing.
 */
const OUTPUT_BATCH_MS = 5;
/** How long a stopped script gets to exit after Ctrl-C before it is hung up on. */
export const STOP_GRACE_MS = 3000;

/** The part of a node-pty process the host uses. */
export type Pty = {
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (event: { exitCode: number }) => void): unknown;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  pause(): void;
  resume(): void;
  kill(): void;
};

export type SpawnPty = (command: TerminalCommand) => Pty;

/** Whose a terminal is. `script` runs a project's run script rather than a shell or CLI. */
export type TerminalOwner = {
  projectId: string;
  paneId: string;
  type: TerminalCreateInput['type'] | 'script';
};

type TerminalRecord = TerminalSnapshot &
  TerminalOwner & {
    process: Pty;
    /** Settles once the process has exited. */
    exited: Promise<void>;
    /** Output not yet sent to the window. */
    pending: string;
    flushTimer?: NodeJS.Timeout;
    /** Pauses the program while the window is behind. */
    flow: OutputFlow;
  };

/**
 * The terminals' processes and output: their scrollback, batching to the window, and
 * pausing a program the window can't keep up with. Runs in the terminal host process, so
 * every byte of output is handled away from the main process.
 */
export class PtyHost {
  private readonly records = new Map<string, TerminalRecord>();

  constructor(
    private readonly spawnPty: SpawnPty,
    /** Output and exits, for the window; exits also for main. */
    private readonly emit: (event: TerminalEvent) => void,
    private readonly graceMs = STOP_GRACE_MS,
  ) {}

  /** Starts the owner's terminal, or returns its running one. */
  create(owner: TerminalOwner, command: TerminalCommand) {
    const running = this.find(
      (record) =>
        record.paneId === owner.paneId &&
        record.type === owner.type &&
        record.exitCode === undefined,
    );
    if (running) return running;
    // A relaunch replaces what exited; its scrollback, up to a megabyte, would otherwise stay
    // until the pane closes, once for each relaunch.
    for (const [id, record] of this.records)
      if (record.paneId === owner.paneId && record.type === owner.type)
        this.records.delete(id);
    return this.spawn(owner, command);
  }

  /**
   * Runs a command in the pane's terminal. Whatever it ran before is stopped first and
   * waited for, so a restarted server finds its port free.
   */
  async run(owner: TerminalOwner, command: TerminalCommand) {
    const previous = [...this.records].filter(
      ([, record]) => record.paneId === owner.paneId,
    );
    await Promise.all(previous.map(([id]) => this.stop(id)));
    for (const [id] of previous) this.records.delete(id);
    return this.spawn(owner, command);
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
      timer = setTimeout(resolve, this.graceMs);
    });
    await Promise.race([record.exited, grace]);
    clearTimeout(timer);
    this.kill(id);
  }

  snapshot(id: string): TerminalSnapshot {
    const { data, sequence, exitCode, flow } = this.get(id);
    flow.restart();
    return { data: data.slice(-SCROLLBACK_BYTES), sequence, exitCode };
  }

  /** The window has shown this much more of the terminal's output. */
  ack(id: string, chars: number) {
    this.records.get(id)?.flow.acked(chars);
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

  close() {
    for (const id of this.records.keys()) this.kill(id);
  }

  private find(matches: (record: TerminalRecord) => boolean) {
    for (const [id, record] of this.records) if (matches(record)) return id;
  }

  private spawn(owner: TerminalOwner, command: TerminalCommand) {
    let process: Pty;
    try {
      process = this.spawnPty(command);
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
      pending: '',
      flow: new OutputFlow(process),
    };
    this.records.set(id, record);
    process.onData((data) => {
      record.pending += data;
      record.flushTimer ??= setTimeout(
        () => this.flushOutput(id, record),
        OUTPUT_BATCH_MS,
      );
    });
    process.onExit(({ exitCode }) => {
      this.flushOutput(id, record);
      record.flow.close();
      record.exitCode = exitCode;
      markExited();
      this.emit({ terminalId: id, sequence: ++record.sequence, exitCode });
    });
    return id;
  }

  /** Sends the output gathered since the last batch, and keeps it for later snapshots. */
  private flushOutput(id: string, record: TerminalRecord) {
    clearTimeout(record.flushTimer);
    record.flushTimer = undefined;
    const data = record.pending;
    if (!data) return;
    record.pending = '';
    record.data += data;
    if (record.data.length > SCROLLBACK_BYTES + SCROLLBACK_SLACK)
      record.data = record.data.slice(-SCROLLBACK_BYTES);
    this.emit({ terminalId: id, sequence: ++record.sequence, data });
    record.flow.sent(data.length);
  }

  private closeWhere(matches: (record: TerminalRecord) => boolean) {
    for (const [id, record] of this.records)
      if (matches(record)) {
        clearTimeout(record.flushTimer);
        record.flow.close();
        this.kill(id);
        this.records.delete(id);
      }
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
