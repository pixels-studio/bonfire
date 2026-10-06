import type { Change, GitStatus, Project } from '../../../shared/contracts';
import * as git from '../git';
import { resolvePlace, type Machines } from '../machines';
import type { Store } from '../persistence';
import type { ProjectView } from '../state';

type RepositoryOptions = {
  store: Store;
  machines: Machines;
  /** Whether an agent in the project is mid-turn, which branch changes must wait for. */
  busy: (project: ProjectView) => boolean;
};

/** Each project's folder and its Git repository: status, diffs, and branches. */
export function repositoryService({
  store,
  machines,
  busy,
}: RepositoryOptions) {
  const machineOf = (project: ProjectView) =>
    machines.get(project.connectionId);
  /** The project folder, on its machine. */
  const placeOf = (project: ProjectView) =>
    machines.place(project.connectionId, project.path);
  const folder = (projectId: string) => placeOf(store.project(projectId));

  /**
   * Panes of one project ask for its status in the same instant, each on its own timer
   * and after each file change. Those that ask while one run is underway share its answer,
   * so eight panes cost one git run rather than eight; a run takes a moment, and on Windows
   * starting a process holds the main process besides.
   */
  const statusRuns = new Map<string, Promise<GitStatus>>();
  const status = (projectId: string) => {
    let run = statusRuns.get(projectId);
    if (!run) {
      run = git.status(folder(projectId)).finally(() => {
        if (statusRuns.get(projectId) === run) statusRuns.delete(projectId);
      });
      statusRuns.set(projectId, run);
    }
    return run;
  };

  /** Branches change the files every agent in the project works on, so none may be mid-turn. */
  function requireIdle(project: ProjectView) {
    if (busy(project))
      throw Error(
        'Wait for the agents in this project to finish, or stop them, before switching branches.',
      );
  }

  /** The current changes among `paths`, such as the files one turn of a conversation touched. */
  async function changesAmong(
    projectId: string,
    paths: string[],
  ): Promise<Change[]> {
    const { machine, path: root } = resolvePlace(folder(projectId));
    const wanted = new Set(
      paths.map((path) =>
        machine.path.isAbsolute(path)
          ? machine.path.relative(root, path)
          : path,
      ),
    );
    const { changes } = await status(projectId);
    return changes.filter((change) => wanted.has(change.path));
  }

  async function diff(projectId: string, path: string) {
    const root = folder(projectId);
    if (path.includes('\0') || path.split(/[\\/]/).includes('..'))
      throw Error('Invalid path');
    // One path's status, not the whole tree's with every untracked file's lines counted.
    const change = await git.change(root, path);
    if (!change) throw Error('File is not a current change');
    if (change.index === '?') return git.diffUntracked(root, path);
    return git.diff(root, path);
  }

  /** Discards the uncommitted changes to one file, or to every file without a path. */
  async function discard(projectId: string, path?: string) {
    if (path?.includes('\0') || path?.split(/[\\/]/).includes('..'))
      throw Error('Invalid path');
    await git.discard(folder(projectId), path);
  }

  async function checkout(projectId: string, branch: string) {
    const project = store.project(projectId);
    requireIdle(project);
    await git.switchBranch(placeOf(project), branch);
  }

  /** Creates a branch from `base` and switches to it; a remote base is fetched first. */
  async function createBranch(projectId: string, name: string, base: string) {
    const project = store.project(projectId);
    requireIdle(project);
    const cwd = placeOf(project);
    // Offline or without a remote, the branch starts from what the clone already has.
    if (base.startsWith('origin/')) await git.fetch(cwd).catch(() => {});
    await git.createBranch(cwd, name, base);
  }

  async function pull(projectId: string) {
    const project = store.project(projectId);
    requireIdle(project);
    await git.pull(placeOf(project));
  }

  return {
    machineOf,
    placeOf,
    folder,
    status,
    changesAmong,
    diff,
    discard,
    checkout,
    createBranch,
    pull,
  };
}

export type Repository = ReturnType<typeof repositoryService>;
