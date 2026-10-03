import type { PullRequest, PullRequestInput } from '$shared/contracts';
import { errorMessage } from '$shared/domain';
import { toast } from './toast.svelte';

const POLL_INTERVAL_MS = 20_000;

/** The pull request of the workspace on screen, kept current while it is watched. */
class PullRequestStore {
  /** `undefined` until looked up; `null` when the workspace's branch has none. */
  current = $state<PullRequest | null>();
  merging = $state(false);
  private sessionId?: string;
  private generation = 0;

  /** Follows a workspace, or none; returns what stops it. */
  watch(sessionId: string | undefined) {
    this.sessionId = sessionId;
    this.current = undefined;
    if (!sessionId) return;
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
    const sessionId = this.sessionId;
    if (!sessionId) return;
    const token = ++this.generation;
    try {
      const pull = await window.bonfire.github.pullRequest(sessionId);
      if (token === this.generation) this.current = pull;
    } catch {
      // gh missing, signed out, or offline: keep what was last known, or no pull request.
      if (token === this.generation) this.current ??= null;
    }
  }

  async create(input: PullRequestInput) {
    const sessionId = this.sessionId;
    if (!sessionId) return;
    const pull = await window.bonfire.github.createPullRequest(
      sessionId,
      input,
    );
    if (sessionId === this.sessionId) this.current = pull;
  }

  async merge() {
    const sessionId = this.sessionId;
    if (!sessionId || this.merging) return;
    this.merging = true;
    try {
      await window.bonfire.github.mergePullRequest(sessionId);
      toast('Merged the pull request.');
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error', duration: 0 });
    } finally {
      this.merging = false;
      await this.reload();
    }
  }
}

export const pullRequest = new PullRequestStore();
