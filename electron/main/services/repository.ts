import type { Change, GitStatus } from '../../../shared/contracts';
import * as git from '../git';
import { resolvePlace, type Machines } from '../machines';
import type { Store } from '../persistence';
import type { ProjectView } from '../state';

type RepositoryOptions = {
  store: Store;
  machines: Machines;
};

/** Each workspace's folder and its Git repository: status and diffs. */
export function repositoryService({ store, machines }: RepositoryOptions) {
  const machineOf = (project: Pick<ProjectView, 'connectionId'>) =>
    machines.get(project.connectionId);
  /** The workspace's folder, on its project's machine. */
  const folder = (workspaceId: string) => {
    const workspace = store.workspace(workspaceId);
    const { connectionId } = store.project(workspace.projectId);
    return machines.place(connectionId, workspace.path);
  };
  /** The project folder itself, which its main workspace works in. */
  const projectFolder = (projectId: string) => {
    const { connectionId, path } = store.project(projectId);
    return machines.place(connectionId, path);
  };

  /**
   * Panes of one workspace ask for its status in the same instant, each on its own timer
   * and after each file change. Those that ask while one run is underway share its answer,
   * so eight panes cost one git run rather than eight; a run takes a moment, and on Windows
   * starting a process holds the main process besides.
   */
  const statusRuns = new Map<string, Promise<GitStatus>>();
  const status = (workspaceId: string) => {
    let run = statusRuns.get(workspaceId);
    if (!run) {
      run = git.status(folder(workspaceId)).finally(() => {
        if (statusRuns.get(workspaceId) === run) statusRuns.delete(workspaceId);
      });
      statusRuns.set(workspaceId, run);
    }
    return run;
  };

  /** The current changes among `paths`, such as the files one turn of a conversation touched. */
  async function changesAmong(
    workspaceId: string,
    paths: string[],
  ): Promise<Change[]> {
    const { machine, path: root } = resolvePlace(folder(workspaceId));
    const wanted = new Set(
      paths.map((path) =>
        machine.path.isAbsolute(path)
          ? machine.path.relative(root, path)
          : path,
      ),
    );
    const { changes } = await status(workspaceId);
    return changes.filter((change) => wanted.has(change.path));
  }

  function requireRelative(path: string) {
    if (path.includes('\0') || path.split(/[\\/]/).includes('..'))
      throw Error('Invalid path');
  }

  async function diff(workspaceId: string, path: string) {
    const root = folder(workspaceId);
    requireRelative(path);
    // One path's status, not the whole tree's with every untracked file's lines counted.
    const change = await git.change(root, path);
    if (!change) throw Error('File is not a current change');
    if (change.index === '?') return git.diffUntracked(root, path);
    return git.diff(root, path);
  }

  /** Discards the uncommitted changes to one file, or to every file without a path. */
  async function discard(workspaceId: string, path?: string) {
    if (path !== undefined) requireRelative(path);
    await git.discard(folder(workspaceId), path);
  }

  return {
    machineOf,
    folder,
    projectFolder,
    status,
    changesAmong,
    diff,
    discard,
  };
}

export type Repository = ReturnType<typeof repositoryService>;
