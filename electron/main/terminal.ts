import * as pty from 'node-pty';
import { randomUUID } from 'node:crypto';
import type {
  TerminalCreateInput,
  TerminalEvent,
  TerminalSnapshot,
} from '../../shared/contracts';
import type { Store } from './persistence';

const SCROLLBACK_BYTES = 1024 * 1024;

type TerminalRecord = TerminalSnapshot & {
  paneId: string;
  sessionId: string;
  type: TerminalCreateInput['type'];
  process: pty.IPty;
};

export class Terminals {
  private readonly records = new Map<string, TerminalRecord>();

  constructor(
    private readonly store: Store,
    private readonly emit: (event: TerminalEvent) => void,
  ) {}

  /** Starts a PTY for the pane, or returns its running one. Shells may attach to any pane. */
  create({ sessionId, paneId, type }: TerminalCreateInput) {
    const session = this.store.session(sessionId);
    const pane = this.store.pane(paneId);
    const paneTerminalType = pane.type === 'terminal' ? 'shell' : pane.type;
    if (
      pane.sessionId !== session.id ||
      (type !== 'shell' && type !== paneTerminalType)
    )
      throw Error('Pane/session mismatch');

    for (const [id, record] of this.records)
      if (
        record.paneId === pane.id &&
        record.type === type &&
        record.exitCode === undefined
      )
        return id;

    const command = type === 'shell' ? defaultShell() : type;
    let process: pty.IPty;
    try {
      process = pty.spawn(
        command,
        type === 'shell' && !isWindows() ? ['-l'] : [],
        {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: session.worktreePath,
          env: terminalEnvironment(),
        },
      );
    } catch (cause) {
      throw Error(
        `Could not launch ${command}. Install the CLI and ensure it is on PATH. ${String(cause)}`,
      );
    }

    const id = randomUUID();
    const record: TerminalRecord = {
      paneId: pane.id,
      sessionId: session.id,
      type,
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
    for (const [id, record] of this.records)
      if (record.sessionId === sessionId) {
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

function isWindows() {
  return process.platform === 'win32';
}

function defaultShell() {
  return process.env.SHELL || (isWindows() ? 'powershell.exe' : '/bin/sh');
}

function terminalEnvironment() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  return { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
}
