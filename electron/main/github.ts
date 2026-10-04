import { spawn, type ChildProcess } from 'node:child_process';
import type {
  Activity,
  GithubRepository,
  GithubSignIn,
  GithubStatus,
  PullRequest,
} from '../../shared/contracts';
import { localMachine, resolvePlace, type Place } from './machines';

const HOST = 'github.com';
/** How long a device-flow sign-in may wait for the user to enter the code. */
const SIGN_IN_TIMEOUT_MS = 3 * 60_000;
const DEVICE_CODE = /one-time code: ([A-Z0-9]{4}-[A-Z0-9]{4})/;
const DEVICE_URL = /(https:\/\/\S+\/login\/device)/;

/** Runs gh, in a repository on whichever machine it is when given one. */
function gh(args: string[], cwd?: Place) {
  const { machine, path } =
    cwd === undefined
      ? { machine: localMachine, path: undefined }
      : resolvePlace(cwd);
  return machine.exec('gh', args, {
    cwd: path,
    env: { GH_PROMPT_DISABLED: '1', NO_COLOR: '1' },
  });
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
    baseRefName: string;
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
    base: pull.baseRefName,
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

/** The repositories in the JSON of GitHub's `user/repos`. */
export function parseRepositories(json: string): GithubRepository[] {
  const repositories = JSON.parse(json) as {
    full_name: string;
    description: string | null;
    private: boolean;
    pushed_at: string | null;
    clone_url: string;
    owner?: { avatar_url?: string };
  }[];
  return repositories.map((repository) => ({
    fullName: repository.full_name,
    description: repository.description || undefined,
    private: repository.private,
    pushedAt: repository.pushed_at ? Date.parse(repository.pushed_at) : 0,
    cloneUrl: repository.clone_url,
    avatarUrl: repository.owner?.avatar_url,
  }));
}

/** A login's GitHub avatar; apps are listed by gh as `app/<name>`, their account being `<name>[bot]`. */
function avatarUrl(login: string, isBot: boolean) {
  const account = isBot ? `${login.replace(/^app\//, '')}[bot]` : login;
  return `https://avatars.githubusercontent.com/${encodeURIComponent(account)}?s=64`;
}

/** The pull requests in the JSON of `gh pr list`, as activity. */
export function parsePullActivity(json: string): Activity[] {
  const pulls = JSON.parse(json) as {
    number: number;
    title: string;
    url: string;
    state: string;
    additions?: number;
    deletions?: number;
    updatedAt: string;
    author?: { login?: string; is_bot?: boolean } | null;
  }[];
  return pulls.map((pull): Activity => {
    const login = pull.author?.login ?? '';
    return {
      id: `pr-${pull.number}`,
      kind: 'pull',
      title: pull.title,
      url: pull.url,
      state:
        pull.state === 'MERGED'
          ? 'merged'
          : pull.state === 'CLOSED'
            ? 'closed'
            : 'open',
      author: login.replace(/^app\//, ''),
      avatarUrl: login ? avatarUrl(login, !!pull.author?.is_bot) : undefined,
      additions: pull.additions,
      deletions: pull.deletions,
      at: Date.parse(pull.updatedAt),
    };
  });
}

type HistoryCommit = {
  oid: string;
  messageHeadline: string;
  committedDate: string;
  url: string;
  additions?: number | null;
  deletions?: number | null;
  author?: {
    name?: string | null;
    avatarUrl?: string | null;
    user?: { login: string } | null;
  } | null;
  associatedPullRequests?: { totalCount: number } | null;
};

/** Sizes an avatar from GitHub's API, keeping only those the renderer may load. */
function sizedAvatar(url: string | null | undefined) {
  if (!url?.startsWith('https://avatars.githubusercontent.com/')) return;
  return `${url}${url.includes('?') ? '&' : '?'}s=64`;
}

/**
 * The commits on the default branch that no pull request brought in, from the JSON of
 * the history query: the ones pushed to it directly.
 */
export function parsePushActivity(json: string): Activity[] {
  const { data } = JSON.parse(json) as {
    data?: {
      repository?: {
        defaultBranchRef?: {
          target?: { history?: { nodes?: (HistoryCommit | null)[] } };
        } | null;
      } | null;
    };
  };
  const commits = data?.repository?.defaultBranchRef?.target?.history?.nodes;
  return (commits ?? [])
    .filter(
      (commit): commit is HistoryCommit =>
        !!commit && !commit.associatedPullRequests?.totalCount,
    )
    .map((commit): Activity => ({
      id: `commit-${commit.oid}`,
      kind: 'push',
      title: commit.messageHeadline,
      url: commit.url,
      author: commit.author?.user?.login ?? commit.author?.name ?? '',
      avatarUrl: sizedAvatar(commit.author?.avatarUrl),
      additions: commit.additions ?? undefined,
      deletions: commit.deletions ?? undefined,
      at: Date.parse(commit.committedDate),
    }));
}

const ACTIVITY_FIELDS =
  'number,title,url,state,additions,deletions,updatedAt,author';
/** How many pull requests, and how many default branch commits, the activity panel reads. */
const ACTIVITY_LIMIT = 100;
/** The newest commits on the default branch; `{owner}` and `{repo}` are filled in by gh. */
const HISTORY_QUERY = `query($owner: String!, $repo: String!, $first: Int!) {
  repository(owner: $owner, name: $repo) {
    defaultBranchRef {
      target {
        ... on Commit {
          history(first: $first) {
            nodes {
              oid
              messageHeadline
              committedDate
              url
              additions
              deletions
              author { name avatarUrl user { login } }
              associatedPullRequests(first: 1) { totalCount }
            }
          }
        }
      }
    }
  }
}`;

const PULL_FIELDS =
  'number,url,title,state,baseRefName,isDraft,mergeable,statusCheckRollup';

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

  /** Repositories the signed-in account owns or works on, recently pushed first. */
  async repositories(): Promise<GithubRepository[]> {
    let output: string;
    try {
      output = await gh([
        'api',
        '--hostname',
        HOST,
        'user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator,organization_member',
      ]);
    } catch (cause) {
      throw ghError(cause);
    }
    return parseRepositories(output);
  }

  /** When the newest merged pull request from `branch` was merged, if there is one. */
  async lastMerge(cwd: Place, branch: string): Promise<number | undefined> {
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
  async pullRequest(cwd: Place): Promise<PullRequest | null> {
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

  /**
   * The repository's pull requests in any state, and the commits pushed straight to its
   * default branch, newest first.
   */
  async activity(cwd: Place): Promise<Activity[]> {
    const [pulls, pushes] = await Promise.all([
      gh(
        [
          'pr',
          'list',
          '--state',
          'all',
          '--search',
          'sort:updated-desc',
          '--limit',
          String(ACTIVITY_LIMIT),
          '--json',
          ACTIVITY_FIELDS,
        ],
        cwd,
      ).then(parsePullActivity, (cause) => {
        throw ghError(cause);
      }),
      // Without a readable history, such as in an empty repository, pull requests still list.
      gh(
        [
          'api',
          'graphql',
          '-F',
          'owner={owner}',
          '-F',
          'repo={repo}',
          '-F',
          `first=${ACTIVITY_LIMIT}`,
          '-f',
          `query=${HISTORY_QUERY}`,
        ],
        cwd,
      ).then(parsePushActivity, (cause) => {
        console.warn(`Could not read pushes: ${ghError(cause).message}`);
        return [];
      }),
    ]);
    return [...pulls, ...pushes].sort((first, second) => second.at - first.at);
  }

  /** Opens a pull request from the branch checked out in `cwd`, which must already be pushed. */
  async createPullRequest(
    cwd: Place,
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
  async mergePullRequest(cwd: Place) {
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
