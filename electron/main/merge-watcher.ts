import type { Pane } from '../../shared/contracts';
import * as git from './git';
import type { GitHub } from './github';
import type { Place } from './machines';
import type { Store } from './persistence';
import type { PaneView, WorkspaceView } from './state';

/** GitHub can't tell the app a pull request merged, so it is asked this often. */
const CHECK_INTERVAL_MS = 60_000;
/** How long a project's default branch is trusted; it only moves when the remote's does. */
const DEFAULT_BRANCH_TTL_MS = 10 * 60_000;

export type MergeWatcherOptions = {
  store: Store;
  github: Pick<GitHub, 'lastMerge'>;
  /** Whether the pane is mid-turn; those are left alone until they finish. */
  isBusy: (paneId: string) => boolean;
  /** Where a workspace's folder is; a path on this computer by default. */
  place?: (workspaceId: string) => Place;
  archive: (paneIds: string[]) => void;
  /** Marks workspaces done, their pull request having merged. */
  done?: (workspaceIds: string[]) => void;
  /** Whether anyone can see the app; checks wait while not, and catch up when it is back. */
  inView?: () => boolean;
  now?: () => number;
};

/**
 * Watches for the pull requests of workspaces' branches merging: the workspace is then done,
 * and, if the user wants, the conversations that worked on the branch are archived.
 */
export class MergeWatcher {
  private timer?: NodeJS.Timeout;
  private checking = false;
  /** A check came due while the app was out of view. */
  private missed = false;
  private readonly defaults = new Map<
    string,
    { branch: string | undefined; at: number }
  >();

  constructor(private readonly options: MergeWatcherOptions) {}

  start() {
    this.timer ??= setInterval(() => {
      if (this.options.inView?.() ?? true) void this.check();
      else this.missed = true;
    }, CHECK_INTERVAL_MS);
  }

  /** Runs the check that came due while the app was out of view, now that it is back. */
  async catchUp() {
    if (!this.missed) return;
    this.missed = false;
    await this.check();
  }

  close() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async check() {
    const { github, isBusy, archive } = this.options;
    if (this.checking) return;
    this.checking = true;
    try {
      const merged: string[] = [];
      const done: string[] = [];
      for (const group of await this.watchedBranches()) {
        // No GitHub remote, gh signed out or missing, or offline: all just mean no news.
        const mergedAt = await github
          .lastMerge(group.cwd, group.branch)
          .catch(() => undefined);
        if (mergedAt === undefined) continue;
        for (const pane of group.panes)
          // A pull request merged before the conversation reached the branch was someone else's.
          if (mergedAt >= pane.workBranch!.since && !isBusy(pane.id))
            merged.push(pane.id);
        if (group.workspace && mergedAt >= group.workspace.createdAt)
          done.push(group.workspace.id);
      }
      if (merged.length) archive(merged);
      if (done.length) this.options.done?.(done);
    } finally {
      this.checking = false;
    }
  }

  /**
   * Branches worth asking about, each with its workspace's folder: those of workspaces in
   * progress, and those open conversations worked on, leaving out default branches.
   */
  private async watchedBranches() {
    const {
      store,
      isBusy,
      place = (workspaceId) => store.workspace(workspaceId).path,
    } = this.options;
    type Group = {
      projectId: string;
      cwd: Place;
      branch: string;
      panes: PaneView[];
      /** The workspace the branch is its own, which merging it finishes. */
      workspace?: WorkspaceView;
    };
    const groups = new Map<string, Group>();
    const groupOf = (workspace: WorkspaceView, branch: string) => {
      const key = `${workspace.id}\0${branch}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          projectId: workspace.projectId,
          cwd: place(workspace.id),
          branch,
          panes: [],
        };
        groups.set(key, group);
      }
      return group;
    };
    for (const workspace of store.state.workspaces)
      if (workspace.status === 'in_progress' && workspace.branch)
        groupOf(workspace, workspace.branch).workspace = workspace;
    if (store.preferences.archiveOnMerge)
      for (const pane of store.state.panes) {
        if (
          pane.archived ||
          !pane.workBranch ||
          !pane.workspaceId ||
          isBusy(pane.id)
        )
          continue;
        const workspace = store.workspace(pane.workspaceId);
        groupOf(workspace, pane.workBranch.name).panes.push(pane);
      }
    const watched = [];
    for (const group of groups.values())
      if (
        group.branch !== (await this.defaultBranch(group.projectId, group.cwd))
      )
        watched.push(group);
    return watched;
  }

  private async defaultBranch(projectId: string, cwd: Place) {
    const now = (this.options.now ?? Date.now)();
    const known = this.defaults.get(projectId);
    if (known && now - known.at < DEFAULT_BRANCH_TTL_MS) return known.branch;
    const branch = await git.defaultBranch(cwd);
    this.defaults.set(projectId, { branch, at: now });
    return branch;
  }
}
