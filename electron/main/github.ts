import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import type { GithubSignIn, GithubStatus } from '../../shared/contracts';

const execFileAsync = promisify(execFile);

const HOST = 'github.com';
/** How long a device-flow sign-in may wait for the user to enter the code. */
const SIGN_IN_TIMEOUT_MS = 3 * 60_000;
const DEVICE_CODE = /one-time code: ([A-Z0-9]{4}-[A-Z0-9]{4})/;
const DEVICE_URL = /(https:\/\/\S+\/login\/device)/;

function gh(args: string[], cwd?: string) {
  return execFileAsync('gh', args, {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' },
  }).then(({ stdout }) => stdout);
}

function isMissing(cause: unknown) {
  return (cause as NodeJS.ErrnoException).code === 'ENOENT';
}

/** GitHub through the user's own `gh` CLI and its login; Bonfire holds no tokens. */
export class GitHub {
  /** The sign-in waiting for the user; `stopped` marks one ended on purpose, not failed. */
  private signingIn?: { child: ChildProcess; stopped: boolean };

  async status(): Promise<GithubStatus> {
    let output: string;
    try {
      output = await gh([
        'auth',
        'status',
        '--hostname',
        HOST,
        '--json',
        'hosts',
      ]);
    } catch (cause) {
      if (isMissing(cause)) return { installed: false };
      // Versions of gh without `--json` can't report an account we could use.
      return { installed: true };
    }
    const { hosts } = JSON.parse(output) as {
      hosts: Record<
        string,
        { state: string; active: boolean; login: string }[]
      >;
    };
    const account = hosts[HOST]?.find(
      ({ active, state }) => active && state === 'success',
    );
    return { installed: true, login: account?.login };
  }

  /**
   * Starts gh's browser device flow, replacing one already waiting. Resolves with the
   * code to enter once gh prints it. `onDone` hears how it ended: no error once signed
   * in or cancelled, otherwise why it failed, including running out of time.
   */
  signIn(onDone: (error?: Error) => void): Promise<GithubSignIn> {
    this.cancelSignIn();
    const child = spawn(
      'gh',
      [
        'auth',
        'login',
        '--web',
        '--hostname',
        HOST,
        '--git-protocol',
        'https',
        '--skip-ssh-key',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const signingIn = { child, stopped: false };
    this.signingIn = signingIn;
    return new Promise((resolve, reject) => {
      let output = '';
      let prompted = false;
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, SIGN_IN_TIMEOUT_MS);
      const read = (chunk: Buffer) => {
        output += chunk;
        const code = DEVICE_CODE.exec(output)?.[1];
        const url = DEVICE_URL.exec(output)?.[1];
        if (prompted || !code || !url) return;
        prompted = true;
        resolve({ userCode: code, verificationUrl: url });
      };
      child.stdout!.on('data', read);
      child.stderr!.on('data', read);
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(
          isMissing(error)
            ? Error('Install the GitHub CLI (gh) to connect GitHub.')
            : error,
        );
      });
      child.on('exit', (code) => {
        clearTimeout(timeout);
        if (this.signingIn === signingIn) this.signingIn = undefined;
        const error =
          code === 0 || signingIn.stopped
            ? undefined
            : timedOut
              ? Error('GitHub sign-in timed out. Try again.')
              : Error(output.trim() || 'GitHub sign-in failed');
        if (!prompted) reject(error ?? Error('GitHub sign-in did not start'));
        else onDone(error);
      });
    });
  }

  /** When the newest merged pull request from `branch` was merged, if there is one. */
  async lastMerge(cwd: string, branch: string): Promise<number | undefined> {
    const output = await gh(
      [
        'pr',
        'list',
        '--head',
        branch,
        '--state',
        'merged',
        '--json',
        'mergedAt',
        '--limit',
        '1',
      ],
      cwd,
    );
    const [pull] = JSON.parse(output) as { mergedAt: string }[];
    return pull ? Date.parse(pull.mergedAt) : undefined;
  }

  /** Stops a sign-in still waiting for the user; `onDone` then hears it failed. */
  cancelSignIn() {
    if (!this.signingIn) return;
    this.signingIn.stopped = true;
    this.signingIn.child.kill();
  }

  close() {
    this.cancelSignIn();
  }
}
