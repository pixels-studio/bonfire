import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { RequestId } from './codex-protocol';
import type { Machine } from './machines';

export type CodexCommand = {
  file: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  /** The remote machine to run it on; this computer when unset. */
  machine?: Machine;
};

export type RpcHandlers = {
  onNotification(method: string, params: any): void;
  /** A request from the server; it stays open until answered with `respond` or `respondError`. */
  onRequest(id: RequestId, method: string, params: any): void;
  /** The server process ended without being closed. */
  onExit(error: Error): void;
};

const REQUEST_TIMEOUT_MS = 300_000;
const STDERR_TAIL_CHARS = 2_000;

/**
 * The Codex binary bundled with the app, run through the app's own Node; the installed
 * `codex` when the app leaves it out. A remote machine runs the `codex` installed there.
 */
export function codexProgram(machine?: Machine): CodexCommand {
  if (machine?.remote) return { file: 'codex', args: [], machine };
  try {
    const resolve = createRequire(__filename).resolve;
    const bin = join(
      dirname(resolve('@openai/codex/package.json')),
      'bin',
      'codex.js',
    );
    // Without this the app binary would start a second Electron app instead of running the script.
    return {
      file: process.execPath,
      args: [bin],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    };
  } catch {
    return { file: 'codex', args: [] };
  }
}

export function codexCommand(machine?: Machine): CodexCommand {
  const program = codexProgram(machine);
  return { ...program, args: [...program.args, 'app-server'] };
}

/**
 * A JSON-RPC connection to `codex app-server` over stdio. Messages are one JSON
 * object per line, with the `jsonrpc` field left out.
 */
export class CodexRpc {
  private nextId = 1;
  private readonly pending = new Map<
    RequestId,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
  private closed = false;
  private stderrTail = '';

  private constructor(
    private readonly child: ReturnType<typeof spawn>,
    private readonly handlers: RpcHandlers,
  ) {
    createInterface({ input: child.stdout! }).on('line', (line) =>
      this.receive(line),
    );
    child.stderr!.on('data', (chunk) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
    });
    // Writes to a dead process surface through `exit`, so the pipe error adds nothing.
    child.stdin!.on('error', () => {});
    child.on('error', (error) => this.end(error));
    child.on('exit', (code, signal) =>
      this.end(
        Error(
          `Codex exited unexpectedly (${signal ?? `code ${code}`})${
            this.stderrTail.trim() ? `: ${this.stderrTail.trim()}` : ''
          }`,
        ),
      ),
    );
  }

  /** Starts the server and completes the protocol handshake. */
  static async start(command: CodexCommand, handlers: RpcHandlers) {
    const child = command.machine
      ? command.machine.spawn(command.file, command.args, {})
      : spawn(command.file, command.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: command.env,
        });
    const rpc = new CodexRpc(child, handlers);
    try {
      await rpc.request('initialize', {
        clientInfo: { name: 'bonfire', title: 'Bonfire', version: '0.1.0' },
        // Needed for the server to ask the user questions.
        capabilities: { experimentalApi: true },
      });
      rpc.send({ method: 'initialized' });
    } catch (cause) {
      rpc.close();
      throw cause;
    }
    return rpc;
  }

  request<Result = unknown>(
    method: string,
    params: unknown,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<Result> {
    if (this.closed) return Promise.reject(Error('Codex is not running'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(`Codex did not answer ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => (clearTimeout(timer), resolve(value)),
        reject: (error) => (clearTimeout(timer), reject(error)),
      });
      this.send({ id, method, params });
    });
  }

  respond(id: RequestId, result: unknown) {
    this.send({ id, result });
  }

  respondError(id: RequestId, message: string) {
    this.send({ id, error: { code: -32601, message } });
  }

  close() {
    this.closed = true;
    this.child.kill();
    this.failPending(Error('Codex was closed'));
  }

  private send(message: object) {
    if (!this.closed) this.child.stdin!.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line: string) {
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      return; // Not a protocol message, such as stray log output.
    }
    const { id, method } = message;
    if (method === undefined) {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (message.error)
        pending.reject(Error(message.error.message ?? 'Codex request failed'));
      else pending.resolve(message.result);
    } else if (id === undefined) {
      this.handlers.onNotification(method, message.params);
    } else {
      this.handlers.onRequest(id, method, message.params);
    }
  }

  private failPending(error: Error) {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  private end(error: Error) {
    if (this.closed) return;
    this.closed = true;
    this.failPending(error);
    this.handlers.onExit(error);
  }
}
