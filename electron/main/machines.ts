import { execFile, spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import * as localPath from 'node:path';
import { join, posix } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { SshConnection } from '../../shared/contracts';
import { defaultShell, isWindows, terminalEnvironment } from './shell';

export type ExecOptions = {
  cwd?: string;
  /** Variables added to the command's environment. */
  env?: Record<string, string>;
  timeout?: number;
  maxBuffer?: number;
  /**
   * Over SSH, whether the command runs in a login shell, so the user's profile sets it up;
   * on by default. Loading a profile can take longer than the command, so programs the
   * usual install folders reach, such as git, leave it off. One not found that way is tried
   * again with it.
   */
  profile?: boolean;
};

/** What node-pty should start to run a command in a terminal. */
export type TerminalCommand = {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
};

export type DirectoryItem = {
  name: string;
  directory: boolean;
  symlink: boolean;
};

export type PipedProcess = ChildProcessByStdio<Writable, Readable, Readable>;

/** A program and its arguments. */
export type Program = { file: string; args: string[] };

/** A computer projects can live on: this one, or one reached over SSH. */
export interface Machine {
  /** `local`, or the id of the SSH connection. */
  readonly id: string;
  readonly remote: boolean;
  /** Runs a program to completion and resolves with its output. A failure carries `stdout` and `stderr`. */
  exec(file: string, args: string[], options?: ExecOptions): Promise<string>;
  /** Starts a program with piped standard streams. */
  spawn(
    file: string,
    args: string[],
    options: { cwd?: string; env?: Record<string, string> },
  ): PipedProcess;
  terminal(
    program: Program,
    options: { cwd: string; env?: Record<string, string> },
  ): TerminalCommand;
  /** An interactive login shell. */
  shell(): Program;
  /** The file's contents; rejects if it is larger than `limit` bytes. */
  readFile(path: string, limit: number): Promise<Buffer>;
  readdir(path: string): Promise<DirectoryItem[]>;
  realpath(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  home(): Promise<string>;
  /** How paths are joined and split there. */
  readonly path: typeof posix;
}

/**
 * Runs a command through the user's shell, so their PATH and version managers apply. Over
 * SSH, the remote login shell wraps it already.
 */
export function scriptProgram(machine: Machine, command: string): Program {
  if (machine.remote) return { file: 'sh', args: ['-c', command] };
  if (isWindows())
    return { file: defaultShell(), args: ['-NoLogo', '-Command', command] };
  // Interactive as well as login, as tools like nvm are often set up only in the rc file.
  return { file: defaultShell(), args: ['-ilc', command] };
}

/** A folder on some machine; a bare path is on this computer. */
export type Place = string | { machine: Machine; path: string };

export function resolvePlace(place: Place) {
  return typeof place === 'string'
    ? { machine: localMachine, path: place }
    : place;
}

export class FileTooLargeError extends Error {}

type RunOptions = ExecOptions & { encoding: 'buffer' | 'utf8' };

/** Runs `file` with no standard input; a failure carries the output, as `promisify(execFile)` would. */
function run(
  file: string,
  args: string[],
  { encoding, env, profile: _, ...options }: RunOptions,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        ...options,
        encoding: 'buffer',
        maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
        timeout: options.timeout ?? 30_000,
        env: { ...baseEnvironment, ...env },
      },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        reject(
          Object.assign(error, {
            stdout: encoding === 'utf8' ? stdout.toString('utf8') : stdout,
            stderr: stderr.toString('utf8'),
          }),
        );
      },
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end();
  });
}

export const localMachine: Machine = {
  id: 'local',
  remote: false,
  path: localPath,
  exec: async (file, args, options = {}) =>
    (await run(file, args, { ...options, encoding: 'utf8' })).toString('utf8'),
  spawn: (file, args, { cwd, env }) =>
    spawn(file, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    }),
  terminal: ({ file, args }, { cwd, env }) => ({
    file,
    args,
    cwd,
    env: { ...terminalEnvironment(), ...env },
  }),
  shell: () => ({ file: defaultShell(), args: isWindows() ? [] : ['-l'] }),
  readFile: async (path, limit) => {
    if ((await stat(path)).size > limit)
      throw new FileTooLargeError('File is too large');
    return readFile(path);
  },
  readdir: async (path) =>
    (await readdir(path, { withFileTypes: true })).map((item) => ({
      name: item.name,
      directory: item.isDirectory(),
      symlink: item.isSymbolicLink(),
    })),
  realpath: (path) => realpath(path),
  exists: async (path) => existsSync(path),
  home: async () => homedir(),
};

/** Single-quotes a word for a POSIX shell. */
export function quote(word: string) {
  return /^[\w@%+=:,./-]+$/.test(word)
    ? word
    : `'${word.replace(/'/g, `'\\''`)}'`;
}

/** Where CLIs installed per-user tend to live, which a non-interactive login may not have on PATH. */
const REMOTE_PATH =
  '$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.cargo/bin:/usr/local/bin:/opt/homebrew/bin:$PATH';

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The command line sent to the remote machine: the user's login shell runs `file` in `cwd`
 * with `env` added, so the PATH and settings of their profile apply.
 */
export function remoteCommand(
  file: string,
  args: string[],
  {
    cwd,
    env = {},
    profile = true,
  }: { cwd?: string; env?: Record<string, string>; profile?: boolean },
) {
  const variables = Object.entries(env)
    .filter(([name]) => VARIABLE_NAME.test(name))
    .map(([name, value]) => `${name}=${quote(value)}`);
  const steps = [`PATH="${REMOTE_PATH}"`, 'export PATH'];
  if (cwd) steps.push(`cd ${quote(cwd)}`);
  steps.push(
    ['exec', 'env', ...variables, ...[file, ...args].map(quote)].join(' '),
  );
  const script = quote(steps.join(' && '));
  return profile
    ? `exec "\${SHELL:-/bin/sh}" -lc ${script}`
    : `exec /bin/sh -c ${script}`;
}

/** Sockets for shared SSH connections; short, as socket paths have a length limit. */
function controlDirectory() {
  const directory = join('/tmp', `bonfire-ssh-${process.getuid?.() ?? 0}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}

function expandHome(path: string) {
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
}

/** Options for every `ssh` run: no prompts, a shared connection, and the connection's port and key. */
export function sshOptions(connection: Omit<SshConnection, 'id' | 'name'>) {
  const options = [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=4',
    '-o',
    'StrictHostKeyChecking=accept-new',
  ];
  // Reusing one connection saves a handshake on every git call.
  if (!isWindows())
    options.push(
      '-o',
      'ControlMaster=auto',
      '-o',
      `ControlPath=${controlDirectory()}/%C`,
      '-o',
      'ControlPersist=300',
    );
  if (connection.port) options.push('-p', String(connection.port));
  if (connection.auth === 'identity' && connection.identityFile)
    options.push(
      '-i',
      expandHome(connection.identityFile),
      '-o',
      'IdentitiesOnly=yes',
    );
  return options;
}

/** ssh exits with 255 when it couldn't connect, rather than passing on the command's code. */
const SSH_FAILED = 255;
/** `env` exits with 127 when it can't find the program it was asked to run. */
const NOT_FOUND = 127;

/** Says which machine couldn't be reached, in ssh's own words. */
function connectionError(connection: SshConnection, cause: unknown) {
  const { code, stderr } = cause as { code?: unknown; stderr?: string };
  if (code === 'ENOENT') return Error('Install OpenSSH (ssh) to connect.');
  if (code !== SSH_FAILED) return cause;
  const reason = (stderr ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('Warning: Permanently added'))
    .pop();
  return Object.assign(
    Error(`Could not reach ${connection.name}${reason ? `: ${reason}` : ''}`),
    { code, stderr },
  );
}

/** Lists a folder as `type name` records, NUL-separated; `l` is a symlink, `d` a folder. */
const LIST_SCRIPT = `cd -- "$1" || exit 1
for f in .* *; do
  case "$f" in .|..) continue ;; esac
  if [ -L "$f" ]; then t=l; elif [ -d "$f" ]; then t=d; elif [ -e "$f" ]; then t=f; else continue; fi
  printf '%s %s\\0' "$t" "$f"
done`;

const READ_SCRIPT = `size=$(wc -c < "$1") || exit 1
[ "$size" -le "$2" ] || exit 3
exec cat -- "$1"`;

const TOO_LARGE = 3;

/** A machine reached through the system's `ssh`, so the user's SSH config and agent apply. */
export class SshMachine implements Machine {
  readonly remote = true;
  readonly path = posix;
  private homeFolder?: Promise<string>;

  constructor(
    readonly connection: SshConnection,
    private readonly ssh = process.env.BONFIRE_SSH || 'ssh',
  ) {}

  get id() {
    return this.connection.id;
  }

  private args(command: string, terminal = false) {
    return [
      ...sshOptions(this.connection),
      terminal ? '-tt' : '-T',
      '--',
      this.connection.host,
      command,
    ];
  }

  private async run(
    file: string,
    args: string[],
    options: RunOptions,
  ): Promise<Buffer> {
    const { cwd, env, profile = true, ...rest } = options;
    try {
      return await run(
        this.ssh,
        this.args(remoteCommand(file, args, { cwd, env, profile })),
        rest,
      );
    } catch (cause) {
      // Installed somewhere only the user's profile adds to the PATH.
      if (!profile && (cause as { code?: unknown }).code === NOT_FOUND)
        return this.run(file, args, { ...options, profile: true });
      throw connectionError(this.connection, cause);
    }
  }

  async exec(file: string, args: string[], options: ExecOptions = {}) {
    const output = await this.run(file, args, { ...options, encoding: 'utf8' });
    return output.toString('utf8');
  }

  spawn(
    file: string,
    args: string[],
    options: { cwd?: string; env?: Record<string, string> },
  ) {
    return spawn(this.ssh, this.args(remoteCommand(file, args, options)), {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  terminal(
    { file, args }: Program,
    { cwd, env }: { cwd: string; env?: Record<string, string> },
  ): TerminalCommand {
    return {
      file: this.ssh,
      args: this.args(remoteCommand(file, args, { cwd, env }), true),
      cwd: homedir(),
      env: terminalEnvironment(),
    };
  }

  shell(): Program {
    return { file: 'sh', args: ['-c', 'exec "${SHELL:-/bin/sh}" -l'] };
  }

  /** Runs a POSIX script, which needs nothing from the user's profile. */
  private sh(script: string, args: string[], options: ExecOptions = {}) {
    return this.exec('sh', ['-c', script, 'sh', ...args], {
      profile: false,
      ...options,
    });
  }

  async readFile(path: string, limit: number) {
    try {
      return await this.run(
        'sh',
        ['-c', READ_SCRIPT, 'sh', path, String(limit)],
        { encoding: 'buffer', maxBuffer: limit + 1024, profile: false },
      );
    } catch (cause) {
      if ((cause as { code?: unknown }).code === TOO_LARGE)
        throw new FileTooLargeError('File is too large');
      throw cause;
    }
  }

  async readdir(path: string): Promise<DirectoryItem[]> {
    const output = await this.sh(LIST_SCRIPT, [path]);
    return output
      .split('\0')
      .filter(Boolean)
      .map((record) => ({
        name: record.slice(2),
        directory: record[0] === 'd',
        symlink: record[0] === 'l',
      }));
  }

  async realpath(path: string) {
    const output = await this.sh(
      'cd -- "$1" 2>/dev/null && pwd -P && exit; realpath -- "$1" 2>/dev/null || readlink -f -- "$1"',
      [path],
    );
    const resolved = output.trim();
    if (!resolved) throw Error(`${path} does not exist`);
    return resolved;
  }

  async exists(path: string) {
    return this.sh('test -e "$1" || test -L "$1"', [path]).then(
      () => true,
      (cause) => {
        if ((cause as { code?: unknown }).code === 1) return false;
        throw cause;
      },
    );
  }

  home() {
    this.homeFolder ??= this.sh('printf %s "$HOME"', []).catch((cause) => {
      this.homeFolder = undefined;
      throw cause;
    });
    return this.homeFolder;
  }
}

/** The machine for each project, with SSH machines made once per connection. */
export class Machines {
  private readonly ssh = new Map<string, SshMachine>();

  constructor(private readonly connections: () => readonly SshConnection[]) {}

  get(connectionId?: string): Machine {
    if (!connectionId) return localMachine;
    const connection = this.connections().find(({ id }) => id === connectionId);
    if (!connection) throw Error('The project’s SSH connection was removed.');
    const known = this.ssh.get(connectionId);
    if (known?.connection === connection) return known;
    const machine = new SshMachine(connection);
    this.ssh.set(connectionId, machine);
    return machine;
  }

  /** A folder on the project's machine. */
  place(connectionId: string | undefined, path: string) {
    return { machine: this.get(connectionId), path };
  }
}
