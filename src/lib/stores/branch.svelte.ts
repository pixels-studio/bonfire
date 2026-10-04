import type { GitHead } from '$shared/contracts';
import { watchProject } from '../file-watch';
import { Refresher } from '../refresher';

/** How often to check a remote folder, whose branch switches nothing reports. */
const REMOTE_POLL_MS = 10_000;

/**
 * The branch the project on screen has checked out, kept current while it is watched.
 * Git decides it, not the app: agents and terminals switch branches too.
 */
class BranchStore {
  /** `undefined` until looked up. */
  head = $state<GitHead>();
  private projectId?: string;
  private generation = 0;
  private refresher?: Refresher;

  /** Follows a project, or none; returns what stops it. */
  watch(projectId: string | undefined) {
    this.projectId = projectId;
    this.head = undefined;
    if (!projectId) return;
    const refresher = new Refresher(() => this.lookUp());
    this.refresher = refresher;
    void refresher.refresh();
    // On this computer Git's HEAD is watched, so a switch is heard of as it happens.
    const watch = watchProject(projectId, ['head'], () =>
      refresher.invalidate(),
    );
    void watch.live.then(
      (live) => {
        if (!live) refresher.setInterval(REMOTE_POLL_MS);
      },
      // A folder that can't be watched still updates when asked, such as after a turn.
      () => {},
    );
    return () => {
      refresher.stop();
      watch.stop();
      if (this.refresher === refresher) this.refresher = undefined;
    };
  }

  /** Looks the branch up again, after any lookup already underway. */
  async reload() {
    await this.refresher?.refresh();
  }

  private async lookUp() {
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
    } catch (cause) {
      // An unreachable machine: keep what was last known, and check back less often.
      if (token === this.generation) this.head ??= { isGit: false };
      throw cause;
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
