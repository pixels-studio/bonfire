import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  GithubSignIn,
  GithubStatus,
  PullRequest,
} from '../../shared/contracts';

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

type CheckRollup = {
  status?: string;
  conclusion?: string;
  state?: string;
}[];

const FAILED = [
  'FAILURE',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'ERROR',
];

/** Folds each check run and commit status into one answer. */
function summarizeChecks(rollup: CheckRollup = []): PullRequest['checks'] {
  if (!rollup.length) return 'none';
  const results = rollup.map(
    ({ status, conclusion, state }) => conclusion || state || status || '',
  );
  if (results.some((result) => FAILED.includes(result))) return 'failing';
  const done = ['SUCCESS', 'NEUTRAL', 'SKIPPED'];
  return results.every((result) => done.includes(result))
    ? 'passing'
    : 'pending';
}

/** The pull request in the JSON of `gh pr view` or `gh pr list`. */
export function parsePullRequest(json: string): PullRequest {
  const pull = JSON.parse(json) as {
    number: number;
    url: string;
    title: string;
    state: string;
    isDraft: boolean;
    mergeable: string;
    statusCheckRollup?: CheckRollup;
  };
  return {
    number: pull.number,
    url: pull.url,
    title: pull.title,
    state:
      pull.state === 'MERGED'
        ? 'merged'
        : pull.state === 'CLOSED'
          ? 'closed'
          : 'open',
    draft: pull.isDraft,
    mergeable:
      pull.mergeable === 'MERGEABLE'
        ? 'yes'
        : pull.mergeable === 'CONFLICTING'
          ? 'no'
          : 'unknown',
    checks: summarizeChecks(pull.statusCheckRollup),
  };
}

const PULL_FIELDS =
  'number,url,title,state,isDraft,mergeable,statusCheckRollup';

/** gh's own explanation, which says what went wrong better than the command line it ran. */
function ghError(cause: unknown) {
  const { stderr } = cause as { stderr?: string };
  if (isMissing(cause)) return Error('Install the GitHub CLI (gh) first.');
  return Error(stderr?.trim() || (cause as Error).message);
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

  /** The newest pull request from the branch checked out in `cwd`, or null if it has none. */
  async pullRequest(cwd: string): Promise<PullRequest | null> {
    try {
      return parsePullRequest(
        await gh(['pr', 'view', '--json', PULL_FIELDS], cwd),
      );
    } catch (cause) {
      if (
        /no pull requests found/i.test(
          (cause as { stderr?: string }).stderr ?? '',
        )
      )
        return null;
      throw ghError(cause);
    }
  }

  /** Opens a pull request from the branch checked out in `cwd`, which must already be pushed. */
  async createPullRequest(
    cwd: string,
    { title, body, base }: { title: string; body: string; base: string },
  ): Promise<PullRequest> {
    try {
      await gh(
        ['pr', 'create', '--title', title, '--body', body, '--base', base],
        cwd,
      );
    } catch (cause) {
      throw ghError(cause);
    }
    const pull = await this.pullRequest(cwd);
    if (!pull)
      throw Error('The pull request was created but could not be read.');
    return pull;
  }

  /** Squash-merges the open pull request of the branch checked out in `cwd`. */
  async mergePullRequest(cwd: string) {
    try {
      await gh(['pr', 'merge', '--squash'], cwd);
    } catch (cause) {
      throw ghError(cause);
    }
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
