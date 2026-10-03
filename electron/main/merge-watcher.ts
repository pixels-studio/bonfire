import type { Pane } from '../../shared/contracts';
import * as git from './git';
import type { GitHub } from './github';
import type { Store } from './persistence';

const CHECK_INTERVAL_MS = 60_000;

export type MergeWatcherOptions = {
  store: Store;
  github: Pick<GitHub, 'lastMerge'>;
  /** Whether the pane is mid-turn; those are left alone until they finish. */
  isBusy: (paneId: string) => boolean;
  /** Whether the pane's project archives on merge; the app-wide preference by default. */
  enabled?: (pane: Pane) => boolean;
  archive: (paneIds: string[]) => void;
};

/** Archives conversations once the pull request for the branch they worked on merges. */
export class MergeWatcher {
  private timer?: NodeJS.Timeout;
  private checking = false;

  constructor(private readonly options: MergeWatcherOptions) {}

  start() {
    this.timer ??= setInterval(() => void this.check(), CHECK_INTERVAL_MS);
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
      enabled = () => store.preferences.archiveOnMerge,
    } = this.options;
    const groups = new Map<
      string,
      { cwd: string; branch: string; panes: Pane[] }
    >();
    for (const pane of store.state.panes) {
      if (
        pane.archived ||
        !pane.workBranch ||
        !pane.sessionId ||
        isBusy(pane.id) ||
        !enabled(pane)
      )
        continue;
      const cwd = store.session(pane.sessionId).worktreePath;
      const branch = pane.workBranch.name;
      const key = `${cwd}\0${branch}`;
      const group = groups.get(key) ?? { cwd, branch, panes: [] };
      group.panes.push(pane);
      groups.set(key, group);
    }
    const defaults = new Map<string, string | undefined>();
    const watched = [];
    for (const group of groups.values()) {
      if (!defaults.has(group.cwd))
        defaults.set(group.cwd, await git.defaultBranch(group.cwd));
      if (group.branch !== defaults.get(group.cwd)) watched.push(group);
    }
    return watched;
  }
}
