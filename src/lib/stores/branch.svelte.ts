import type { GitHead } from '$shared/contracts';

const POLL_INTERVAL_MS = 10_000;

/**
 * The branch the project on screen has checked out, kept current while it is watched.
 * Git decides it, not the app: agents and terminals switch branches too.
 */
class BranchStore {
  /** `undefined` until looked up. */
  head = $state<GitHead>();
  private projectId?: string;
  private generation = 0;

  /** Follows a project, or none; returns what stops it. */
  watch(projectId: string | undefined) {
    this.projectId = projectId;
    this.head = undefined;
    if (!projectId) return;
    void this.reload();
    const timer = setInterval(() => {
      if (document.hasFocus()) void this.reload();
    }, POLL_INTERVAL_MS);
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
      const next = await window.bonfire.git.head(projectId);
      // An unchanged head keeps its object, so nothing that follows the branch reloads.
      if (
        token === this.generation &&
        (next.isGit !== this.head?.isGit || next.branch !== this.head?.branch)
      )
        this.head = next;
    } catch {
      // An unreachable machine: keep what was last known.
      if (token === this.generation) this.head ??= { isGit: false };
    }
  }

  /** Switches the project on screen to another branch. */
  async switchTo(name: string) {
    const projectId = this.projectId;
    if (!projectId) return;
    try {
      await window.bonfire.git.checkout(projectId, name);
    } finally {
      await this.reload();
    }
  }

  /** Creates a branch from `base` and switches to it. */
  async create(name: string, base: string) {
    const projectId = this.projectId;
    if (!projectId) return;
    try {
      await window.bonfire.git.createBranch(projectId, name, base);
    } finally {
      await this.reload();
    }
  }

  /** Switches to `name` and brings it up to date, such as `main` after a merge. */
  async switchAndPull(name: string) {
    const projectId = this.projectId;
    if (!projectId) return;
    await this.switchTo(name);
    await window.bonfire.git.pull(projectId);
  }
}

export const branch = new BranchStore();
