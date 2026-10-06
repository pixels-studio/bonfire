import type {
  ActionId,
  PullRequest,
  PullRequestDraft,
  PullRequestInput,
} from '$shared/contracts';
import { errorMessage } from '$shared/domain';
import { watchWorkspace } from '../file-watch';
import { Refresher } from '../refresher';
import { toast } from './toast.svelte';

/**
 * GitHub can't tell the app when checks finish or a pull request merges, so an open one is
 * checked back on: often while its checks run, and now and then once they have finished.
 */
const CHECKS_POLL_MS = 20_000;
const OPEN_POLL_MS = 60_000;
/** The least time between lookups set off by commits and pushes, which come in bursts. */
const PULL_GAP_MS = 5000;
/** The least time between looking at the branch's work after a commit, push, or switch. */
const DRAFT_GAP_MS = 2000;
/**
 * The least time between looking at it while files keep changing, as they do all through an
 * agent's turn. Each look runs several Git commands, and edits only move the count of
 * uncommitted files; the end of the turn looks again anyway.
 */
const DRAFT_FILES_GAP_MS = 15_000;
/** How often to look at the work in a remote folder, whose changes nothing reports. */
const REMOTE_DRAFT_POLL_MS = 20_000;
/** An action whose agent never reports back, such as one that is stuck, is given up on after this long. */
const ACTION_TIMEOUT_MS = 10 * 60_000;

/** The pull request of the branch on screen, kept current while it is watched. */
class PullRequestStore {
  /** `undefined` until looked up; `null` when the branch has none. */
  current = $state<PullRequest | null>();
  merging = $state(false);
  /** What the checked-out branch holds, looked up while it has no open pull request. */
  draft = $state<PullRequestDraft>();
  /** On the base branch, where a pull request makes no sense. */
  readonly onBase = $derived(
    !!this.draft && this.draft.branch === this.draft.base,
  );
  /** On the base branch, or a branch with an open pull request, with work to push. */
  readonly pushable = $derived(
    !!this.draft &&
      this.draft.uncommitted + this.draft.unpushed > 0 &&
      (this.onBase || this.current?.state === 'open'),
  );
  /** The action being handed to an agent, if any. */
  running = $state<ActionId>();
  /** The pane whose agent is carrying out `running`; the action lasts until its turn ends. */
  agentPaneId = $state<string>();
  private workspaceId?: string;
  private generation = 0;
  private pulls?: Refresher;
  private drafts?: Refresher;
  private timeout?: ReturnType<typeof setTimeout>;
  /** Panes whose turn ended before the action learned which pane it was running in. */
  private finishedEarly = new Set<string>();

  /**
   * Follows a workspace's checked-out branch, or none; returns what stops it. Watch again
   * when the branch changes, since each branch has its own pull request.
   */
  watch(workspaceId: string | undefined) {
    this.workspaceId = workspaceId;
    this.current = undefined;
    this.draft = undefined;
    const session = ++this.generation;
    if (!workspaceId) return;
    const current = () => session === this.generation;
    const pulls = new Refresher(
      async () => {
        const pull = await this.lookUpPull(workspaceId, current);
        pulls.setInterval(
          pull?.state !== 'open'
            ? undefined
            : pull.checks === 'pending'
              ? CHECKS_POLL_MS
              : OPEN_POLL_MS,
        );
      },
      { minGapMs: PULL_GAP_MS },
    );
    const drafts = new Refresher(() => this.lookUpDraft(workspaceId, current), {
      minGapMs: DRAFT_GAP_MS,
    });
    this.pulls = pulls;
    this.drafts = drafts;
    void pulls.refresh();
    void drafts.refresh();
    // A push moves the remote branch, which can open or update the pull request; the
    // branch's own work changes with its files, its commits, and its pushes.
    const watch = watchWorkspace(
      workspaceId,
      ['files', 'refs', 'head'],
      (kind) => {
        drafts.invalidate(kind === 'files' ? DRAFT_FILES_GAP_MS : undefined);
        if (kind === 'refs') pulls.invalidate();
      },
    );
    void watch.live.then(
      (live) => {
        if (!live) drafts.setInterval(REMOTE_DRAFT_POLL_MS);
      },
      // A folder that can't be watched still updates when asked, such as after a turn.
      () => {},
    );
    return () => {
      pulls.stop();
      drafts.stop();
      watch.stop();
    };
  }

  /** Looks the pull request and the branch's work up again, after any lookup underway. */
  async reload() {
    await Promise.all([this.pulls?.refresh(), this.drafts?.refresh()]);
  }

  private async lookUpPull(workspaceId: string, current: () => boolean) {
    try {
      const pull = await window.bonfire.github.pullRequest(workspaceId);
      if (current()) this.current = pull;
      return pull;
    } catch (cause) {
      // gh missing, signed out, or offline: keep what was last known, or no pull request,
      // and check back less often until it answers.
      if (current()) this.current ??= null;
      throw cause;
    }
  }

  /** Looked up even with an open pull request, to know whether it has work left to push. */
  private async lookUpDraft(workspaceId: string, current: () => boolean) {
    const draft = await window.bonfire.github
      .pullRequestDraft(workspaceId)
      .catch(() => undefined);
    if (current()) this.draft = draft;
  }

  async create(input: PullRequestInput) {
    const workspaceId = this.workspaceId;
    if (!workspaceId) return;
    const pull = await window.bonfire.github.createPullRequest(
      workspaceId,
      input,
    );
    if (workspaceId === this.workspaceId) this.current = pull;
  }

  /** Told of the pane an agent was given the pull request in, to bring it on screen. */
  onAgentPane?: (paneId: string) => void | Promise<void>;

  /** Opens a pane with the last-used agent and has it carry out `action`. */
  async run(action: ActionId) {
    const workspaceId = this.workspaceId;
    if (!workspaceId || this.running) return;
    this.running = action;
    this.finishedEarly.clear();
    // Whatever happens to the agent, the action does not stay busy forever.
    this.timeout = setTimeout(() => {
      toast('The agent took too long to finish, so the action was released.', {
        variant: 'error',
      });
      this.settle();
    }, ACTION_TIMEOUT_MS);
    try {
      const paneId = await window.bonfire.github.runAction(workspaceId, action);
      if (this.finishedEarly.has(paneId)) return this.settle();
      this.agentPaneId = paneId;
      await this.onAgentPane?.(paneId);
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error', duration: 0 });
      this.settle();
    }
  }

  /** Ends the running action once its agent's turn is over, or its pane is gone. */
  settle(paneId?: string) {
    if (paneId !== undefined && paneId !== this.agentPaneId) {
      // A quick failure can be reported before the pane's id has come back.
      if (this.running && !this.agentPaneId) this.finishedEarly.add(paneId);
      return;
    }
    clearTimeout(this.timeout);
    this.running = undefined;
    this.agentPaneId = undefined;
    void this.reload();
  }

  /** Squash-merges the open pull request; main marks the workspace done. */
  async merge() {
    const workspaceId = this.workspaceId;
    if (!workspaceId || this.merging) return;
    this.merging = true;
    try {
      await window.bonfire.github.mergePullRequest(workspaceId);
      toast('Merged the pull request.');
      await this.onMerged?.();
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error', duration: 0 });
    } finally {
      this.merging = false;
      await this.reload();
    }
  }

  /** Told once a merge from the app went through, as it changes the workspace's status. */
  onMerged?: () => void | Promise<void>;
}

export const pullRequest = new PullRequestStore();
