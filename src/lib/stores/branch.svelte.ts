import type { GitHead } from '$shared/contracts';
import { watchWorkspace } from '../file-watch';
import { Refresher } from '../refresher';

/** How often to check a remote folder, whose branch switches nothing reports. */
const REMOTE_POLL_MS = 10_000;

/**
 * The branch the workspace on screen has checked out, kept current while it is watched.
 * Git decides it, not the app: agents and terminals switch branches too.
 */
class BranchStore {
  /** `undefined` until looked up. */
  head = $state<GitHead>();
  private workspaceId?: string;
  private generation = 0;
  private refresher?: Refresher;

  /** Follows a workspace, or none; returns what stops it. */
  watch(workspaceId: string | undefined) {
    this.workspaceId = workspaceId;
    this.head = undefined;
    if (!workspaceId) return;
    const refresher = new Refresher(() => this.lookUp());
    this.refresher = refresher;
    void refresher.refresh();
    // On this computer Git's HEAD is watched, so a switch is heard of as it happens.
    const watch = watchWorkspace(workspaceId, ['head'], () =>
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
    const workspaceId = this.workspaceId;
    if (!workspaceId) return;
    const token = ++this.generation;
    try {
      const next = await window.bonfire.git.head(workspaceId);
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
}

export const branch = new BranchStore();
