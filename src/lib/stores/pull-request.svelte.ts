import type {
  ActionId,
  PullRequest,
  PullRequestDraft,
  PullRequestInput,
} from '$shared/contracts';
import { errorMessage } from '$shared/domain';
import { branch } from './branch.svelte';
import { toast } from './toast.svelte';

const POLL_INTERVAL_MS = 20_000;
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
  private projectId?: string;
  private generation = 0;
  private timeout?: ReturnType<typeof setTimeout>;
  /** Panes whose turn ended before the action learned which pane it was running in. */
  private finishedEarly = new Set<string>();

  /**
   * Follows a project's checked-out branch, or none; returns what stops it. Watch again
   * when the branch changes, since each branch has its own pull request.
   */
  watch(projectId: string | undefined) {
    this.projectId = projectId;
    this.current = undefined;
    this.draft = undefined;
    if (!projectId) return;
    void this.reload();
    const timer = setInterval(() => void this.reload(), POLL_INTERVAL_MS);
    const onFocus = () => void this.reload();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }

  async reload() {
    const projectId = this.projectId;
    if (!projectId) return;
    const token = ++this.generation;
    try {
      const pull = await window.bonfire.github.pullRequest(projectId);
      // Looked up even with an open pull request, to know whether it has work left to push.
      const draft = await window.bonfire.github
        .pullRequestDraft(projectId)
        .catch(() => undefined);
      if (token === this.generation) {
        this.current = pull;
        this.draft = draft;
      }
    } catch {
      // gh missing, signed out, or offline: keep what was last known, or no pull request.
      if (token === this.generation) this.current ??= null;
    }
  }

  async create(input: PullRequestInput) {
    const projectId = this.projectId;
    if (!projectId) return;
    const pull = await window.bonfire.github.createPullRequest(
      projectId,
      input,
    );
    if (projectId === this.projectId) this.current = pull;
  }

  /** Told of the pane an agent was given the pull request in, to bring it on screen. */
  onAgentPane?: (paneId: string) => void | Promise<void>;

  /** Opens a pane with the last-used agent and has it carry out `action`. */
  async run(action: ActionId) {
    const projectId = this.projectId;
    if (!projectId || this.running) return;
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
      const paneId = await window.bonfire.github.runAction(projectId, action);
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

  async merge() {
    const projectId = this.projectId;
    const base = this.current?.base;
    if (!projectId || this.merging) return;
    this.merging = true;
    try {
      await window.bonfire.github.mergePullRequest(projectId);
      toast('Merged the pull request.', {
        duration: 10_000,
        action: base
          ? {
              label: `Switch to ${base}`,
              run: () =>
                void branch.switchAndPull(base).catch((cause) =>
                  toast(errorMessage(cause), {
                    variant: 'error',
                    duration: 0,
                  }),
                ),
            }
          : undefined,
      });
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error', duration: 0 });
    } finally {
      this.merging = false;
      await this.reload();
    }
  }
}

export const pullRequest = new PullRequestStore();
