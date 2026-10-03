import * as pty from 'node-pty';
import { randomUUID } from 'node:crypto';
import type {
  TerminalCreateInput,
  TerminalEvent,
  TerminalSnapshot,
} from '../../shared/contracts';
import type { Store } from './persistence';
import {
  defaultShell,
  isWindows,
  terminalEnvironment,
  type WorkspaceEnvironment,
} from './shell';

const SCROLLBACK_BYTES = 1024 * 1024;

type TerminalRecord = TerminalSnapshot & {
  /** Unset for the workspace's own terminals. */
  paneId?: string;
  sessionId: string;
  type: TerminalCreateInput['type'];
  /** Which of the workspace's own shells this is; unset for pane terminals. */
  tab?: number;
  process: pty.IPty;
};

export class Terminals {
  private readonly records = new Map<string, TerminalRecord>();

  constructor(
    private readonly store: Store,
    private readonly emit: (event: TerminalEvent) => void,
    private readonly environment: (sessionId: string) => WorkspaceEnvironment,
  ) {}

  /**
   * Starts a PTY for the workspace, or for one of its panes, or returns the running one.
   * Shells may attach to any pane; `setup` only finds the workspace's setup script.
   */
  create({ sessionId, paneId, type, tab = 0 }: TerminalCreateInput) {
    const session = this.store.session(sessionId);
    if (type === 'setup') {
      const setup = this.find(
        (record) => record.sessionId === session.id && record.type === 'setup',
      );
      if (!setup) throw Error('No setup script has run in this workspace');
      return setup;
    }
    if (paneId) {
      const pane = this.store.pane(paneId);
      const paneTerminalType = pane.type === 'terminal' ? 'shell' : pane.type;
      if (
        pane.sessionId !== session.id ||
        (type !== 'shell' && type !== paneTerminalType)
      )
        throw Error('Pane/session mismatch');
    } else if (type !== 'shell') throw Error('Only shells run without a pane');

    const owner = {
      sessionId: session.id,
      paneId,
      type,
      tab: paneId ? undefined : tab,
    };
    const running = this.find(
      (record) =>
        record.sessionId === owner.sessionId &&
        record.paneId === owner.paneId &&
        record.type === owner.type &&
        record.tab === owner.tab &&
        record.exitCode === undefined,
    );
    if (running) return running;

    const command = type === 'shell' ? defaultShell() : type;
    return this.spawn(
      owner,
      command,
      type === 'shell' && !isWindows() ? ['-l'] : [],
      session.worktreePath,
    );
  }

  /**
   * Runs the workspace's setup script in a login shell, replacing any earlier run, and
   * resolves with its exit code. Its output is what `create({ type: 'setup' })` shows.
   */
  runSetup(sessionId: string, script: string) {
    const session = this.store.session(sessionId);
    this.closeWhere(
      (record) => record.sessionId === sessionId && record.type === 'setup',
    );
    const id = this.spawn(
      { sessionId, type: 'setup' },
      defaultShell(),
      isWindows() ? ['-Command', script] : ['-l', '-c', script],
      session.worktreePath,
    );
    const record = this.get(id);
    return new Promise<number>((resolve) =>
      record.process.onExit(({ exitCode }) => resolve(exitCode)),
    );
  }

  private find(matches: (record: TerminalRecord) => boolean) {
    for (const [id, record] of this.records) if (matches(record)) return id;
  }

  private spawn(
    owner: Pick<TerminalRecord, 'sessionId' | 'paneId' | 'type' | 'tab'>,
    command: string,
    args: string[],
    cwd: string,
  ) {
    let process: pty.IPty;
    try {
      process = pty.spawn(command, args, {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd,
        env: {
          ...terminalEnvironment(),
          ...this.environment(owner.sessionId),
        },
      });
    } catch (cause) {
      throw Error(
        `Could not launch ${command}. Install the CLI and ensure it is on PATH. ${String(cause)}`,
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

  closeSession(sessionId: string) {
    this.closeWhere((record) => record.sessionId === sessionId);
  }

  /** Ends the workspace's own shell in a tab; its scrollback goes with it. */
  closeTab(sessionId: string, tab: number) {
    this.closeWhere(
      (record) =>
        record.sessionId === sessionId &&
        !record.paneId &&
        record.type === 'shell' &&
        record.tab === tab,
    );
  }

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
