import type { Pane } from '../../shared/contracts';
import * as git from './git';
import type { GitHub } from './github';
import type { Place } from './machines';
import type { Store } from './persistence';

/** GitHub can't tell the app a pull request merged, so it is asked this often. */
const CHECK_INTERVAL_MS = 60_000;
/** How long a project's default branch is trusted; it only moves when the remote's does. */
const DEFAULT_BRANCH_TTL_MS = 10 * 60_000;

export type MergeWatcherOptions = {
  store: Store;
  github: Pick<GitHub, 'lastMerge'>;
  /** Whether the pane is mid-turn; those are left alone until they finish. */
  isBusy: (paneId: string) => boolean;
  /** Where a project's folder is; a path on this computer by default. */
  place?: (projectId: string) => Place;
  archive: (paneIds: string[]) => void;
  /** Whether anyone can see the app; checks wait while not, and catch up when it is back. */
  inView?: () => boolean;
  now?: () => number;
};

/** Archives conversations once the pull request for the branch they worked on merges. */
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
      for (const { cwd, branch, panes } of await this.watchedBranches()) {
        // No GitHub remote, gh signed out or missing, or offline: all just mean no news.
        const mergedAt = await github
          .lastMerge(cwd, branch)
          .catch(() => undefined);
        if (mergedAt === undefined) continue;
        for (const pane of panes)
          // A pull request merged before the conversation reached the branch was someone else's.
          if (mergedAt >= pane.workBranch!.since && !isBusy(pane.id))
            merged.push(pane.id);
      }
      if (merged.length) archive(merged);
    } finally {
      this.checking = false;
    }
  }

  /** Open conversations grouped by repository and branch, leaving out default branches. */
  private async watchedBranches() {
    const {
      store,
      isBusy,
      place = (projectId) => store.project(projectId).path,
    } = this.options;
    if (!store.preferences.archiveOnMerge) return [];
    const groups = new Map<
      string,
      { projectId: string; cwd: Place; branch: string; panes: Pane[] }
    >();
    for (const pane of store.state.panes) {
      if (
        pane.archived ||
        !pane.workBranch ||
        !pane.projectId ||
        isBusy(pane.id)
      )
        continue;
      const branch = pane.workBranch.name;
      const key = `${pane.projectId}\0${branch}`;
      const group = groups.get(key) ?? {
        projectId: pane.projectId,
        cwd: place(pane.projectId),
        branch,
        panes: [],
      };
      group.panes.push(pane);
      groups.set(key, group);
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
