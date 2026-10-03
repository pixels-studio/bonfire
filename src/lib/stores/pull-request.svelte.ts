import type {
  PullRequest,
  PullRequestDraft,
  PullRequestInput,
} from '$shared/contracts';
import { errorMessage } from '$shared/domain';
import { branch } from './branch.svelte';
import { toast } from './toast.svelte';

const POLL_INTERVAL_MS = 20_000;

/** The pull request of the branch on screen, kept current while it is watched. */
class PullRequestStore {
  /** `undefined` until looked up; `null` when the branch has none. */
  current = $state<PullRequest | null>();
  merging = $state(false);
  pushing = $state(false);
  /** What the checked-out branch holds, looked up while it has no open pull request. */
  draft = $state<PullRequestDraft>();
  /** On the base branch with work to push, where a pull request makes no sense. */
  readonly pushable = $derived(
    !!this.draft &&
      this.draft.branch === this.draft.base &&
      this.draft.uncommitted + this.draft.unpushed > 0,
  );
  /** Whether a pull request is being written and opened for the branch. */
  creating = $state(false);
  private projectId?: string;
  private generation = 0;

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
      const draft =
        pull?.state === 'open'
          ? undefined
          : await window.bonfire.github
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

  /** Has the text model write and open a pull request for the branch on screen. */
  async createForMe() {
    const projectId = this.projectId;
    if (!projectId || this.creating) return;
    this.creating = true;
    try {
      const pull =
        await window.bonfire.github.createPullRequestForMe(projectId);
      if (projectId === this.projectId) this.current = pull;
      toast(`Opened pull request #${pull.number}.`, {
        duration: 10_000,
        action: {
          label: 'View on GitHub',
          run: () =>
            void window.bonfire.github
              .openPullRequest(projectId)
              .catch((cause) =>
                toast(errorMessage(cause), { variant: 'error' }),
              ),
        },
      });
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error', duration: 0 });
    } finally {
      this.creating = false;
      await this.reload();
    }
  }

  /** Commits and pushes the base branch's changes, which can't go through a pull request. */
  async push() {
    const projectId = this.projectId;
    if (!projectId || this.pushing) return;
    this.pushing = true;
    try {
      await window.bonfire.github.push(projectId);
      toast('Pushed to the remote.');
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error', duration: 0 });
    } finally {
      this.pushing = false;
      await this.reload();
    }
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
