import type { PullRequest, PullRequestInput } from '$shared/contracts';
import { errorMessage } from '$shared/domain';
import { branch } from './branch.svelte';
import { toast } from './toast.svelte';

const POLL_INTERVAL_MS = 20_000;

/** The pull request of the branch on screen, kept current while it is watched. */
class PullRequestStore {
  /** `undefined` until looked up; `null` when the branch has none. */
  current = $state<PullRequest | null>();
  merging = $state(false);
  private projectId?: string;
  private generation = 0;

  /**
   * Follows a project's checked-out branch, or none; returns what stops it. Watch again
   * when the branch changes, since each branch has its own pull request.
   */
  watch(projectId: string | undefined) {
    this.projectId = projectId;
    this.current = undefined;
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
      if (token === this.generation) this.current = pull;
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
