import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { DictationEvent } from '../../shared/contracts';

/** How long a stopped helper gets to deliver its last words before it is killed. */
const STOP_GRACE_MS = 3_000;

/**
 * Runs the native dictation helper (native/dictation), one session at a time, and relays
 * what it hears. Only one composer dictates at once, so starting again ends the last session.
 */
export class Dictation {
  private current?: { id: string; child: ChildProcessWithoutNullStreams };

  constructor(
    private readonly options: {
      /**
       * The helper's path (a PowerShell script on Windows, a native binary on macOS);
       * undefined where dictation isn't supported.
       */
      program: string | undefined;
      /**
       * Whether the helper asks for permissions as itself rather than through the app,
       * for development, where the app is a bare Electron without usage descriptions.
       */
      disclaim: boolean;
      emit: (event: DictationEvent) => void;
      log?: (message: string) => void;
    },
  ) {}

  available() {
    const { program } = this.options;
    return (
      (process.platform === 'darwin' || process.platform === 'win32') &&
      !!program &&
      existsSync(program)
    );
  }

  /** How to run the helper; Windows runs it through the PowerShell that ships with the OS. */
  private command(language: string): [string, string[]] {
    const program = this.options.program!;
    if (process.platform !== 'win32') return [program, [language]];
    const powershell = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    return [
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        program,
        language,
      ],
    ];
  }

  start(language: string) {
    if (!this.available()) throw Error('Dictation is unavailable.');
    this.close();
    const session = randomUUID();
    const [program, args] = this.command(language);
    const child = spawn(program, args, {
      stdio: 'pipe',
      windowsHide: true,
      env: {
        ...process.env,
        ...(this.options.disclaim && { BONFIRE_DICTATION_DISCLAIM: '1' }),
      },
    });
    this.current = { id: session, child };
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      if (this.current?.child === child) this.current = undefined;
      this.options.emit({ session, type: 'end' });
    };
    createInterface({ input: child.stdout }).on('line', (line) => {
      let message: { type: string; error?: string };
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.type === 'end') return end();
      if (message.type === 'error')
        this.options.log?.(`Dictation failed: ${message.error}`);
      this.options.emit({ ...message, session } as DictationEvent);
    });
    child.stderr.on('data', (data) =>
      this.options.log?.(`Dictation: ${String(data).trim()}`),
    );
    child.stdin.on('error', () => {});
    child.on('error', (error) => {
      this.options.log?.(`Dictation could not start: ${error.message}`);
      this.options.emit({ session, type: 'error', error: 'unavailable' });
      end();
    });
    child.on('exit', end);
    return session;
  }

  stop(session: string) {
    if (this.current?.id !== session) return;
    const { child } = this.current;
    child.stdin.end('stop\n');
    setTimeout(() => child.kill(), STOP_GRACE_MS).unref();
  }

  close() {
    this.current?.child.kill();
    this.current = undefined;
  }
}
