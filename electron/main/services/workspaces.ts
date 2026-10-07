import { randomUUID } from 'node:crypto';
import type { WorkspaceCreateInput } from '../../../shared/contracts';
import { errorMessage, isReopenable, slug } from '../../../shared/domain';
import { landmarkName } from '../../../shared/landmarks';
import type { Filesystem } from '../filesystem';
import * as git from '../git';
import { resolvePlace, scriptProgram, type Place } from '../machines';
import type { Store } from '../persistence';
import {
  readBonfireConfig,
  workspaceEnvironment,
  type Scripts,
} from '../scripts';
import type { ProjectView, WorkspaceView } from '../state';
import type { Terminals } from '../terminal';
import type { Panes } from './panes';
import type { Repository } from './repository';

/** How long an archive script may run before the workspace is archived without it. */
const ARCHIVE_SCRIPT_TIMEOUT_MS = 2 * 60_000;

type WorkspaceOptions = {
  store: Store;
  repository: Repository;
  panes: Panes;
  terminals: Terminals;
  scripts: Scripts;
  files: Filesystem;
  /** Whether the pane's agent is mid-turn. */
  isRunning: (paneId: string) => boolean;
  /** The user's GitHub login, which new branches are put under; unset when signed out. */
  login: () => Promise<string | undefined>;
  /** Tells the window a workspace changed without its asking, such as when one is done. */
  changed: () => void;
};

/** Where an archived workspace's uncommitted work is kept until it is unarchived. */
const archiveRef = (workspaceId: string) =>
  `refs/bonfire-archive/${workspaceId}`;

/**
 * Workspaces: each a Git worktree of its project on a branch of its own, made from the
 * default branch and named after a landmark. Archiving keeps the branch and the uncommitted
 * work but removes the folder; unarchiving brings both back.
 */
export function workspaceService({
  store,
  repository,
  panes,
  terminals,
  scripts,
  files,
  isRunning,
  login,
  changed,
}: WorkspaceOptions) {
  /** What new branches go under: the GitHub login, else the Git user's name. */
  async function branchPrefix(repo: Place) {
    const name =
      (await login().catch(() => undefined)) ??
      (await git.git(repo, ['config', 'user.name']).catch(() => ''));
    return slug(name);
  }

  /** Where the project's worktrees go: `~/.bonfire/worktrees/<project>` on its machine. */
  async function worktreesFolder(project: ProjectView) {
    const machine = repository.machineOf(project);
    return machine.path.join(
      await machine.home(),
      '.bonfire',
      'worktrees',
      slug(project.name) || 'project',
    );
  }

  /** The first landmark free as a name, a branch, and a folder. */
  async function freeName(project: ProjectView, repo: Place, prefix: string) {
    const machine = repository.machineOf(project);
    const parent = await worktreesFolder(project);
    const taken = new Set(
      store.state.workspaces
        .filter(({ projectId }) => projectId === project.id)
        .map(({ name }) => name),
    );
    for (;;) {
      const name = landmarkName(taken);
      const branch = prefix ? `${prefix}/${name}` : name;
      const path = machine.path.join(parent, name);
      const [branchTaken, folderTaken] = await Promise.all([
        git.hasRef(repo, `refs/heads/${branch}`),
        machine.exists(path),
      ]);
      if (!branchTaken && !folderTaken) return { name, branch, path };
      taken.add(name);
    }
  }

  /** The script the project runs at a moment: its own setting, else its `bonfire.json`'s. */
  async function scriptFor(
    workspace: WorkspaceView,
    which: 'setup' | 'archive',
  ) {
    const project = store.project(workspace.projectId);
    const own = which === 'setup' ? project.setupScript : project.archiveScript;
    if (own) return own;
    const { machine, path } = resolvePlace(repository.folder(workspace.id));
    return (await readBonfireConfig(machine, path))[which];
  }

  /** Runs the setup script in a pane of the workspace, if the project has one. */
  async function setUp(workspace: WorkspaceView) {
    const command = await scriptFor(workspace, 'setup');
    if (command) await scripts.runSetup(workspace, command);
  }

  /** Runs the archive script to completion; a failure is logged, as it shouldn't block archiving. */
  async function runArchiveScript(workspace: WorkspaceView) {
    const command = await scriptFor(workspace, 'archive');
    if (!command) return;
    const { machine, path } = resolvePlace(repository.folder(workspace.id));
    const { file, args } = scriptProgram(machine, command);
    await machine
      .exec(file, args, {
        cwd: path,
        env: workspaceEnvironment(
          workspace,
          store.project(workspace.projectId),
        ),
        timeout: ARCHIVE_SCRIPT_TIMEOUT_MS,
      })
      .catch((cause) =>
        console.warn(
          `Archive script of ${workspace.name} failed: ${errorMessage(cause)}`,
        ),
      );
  }

  /** Throws unless the workspace is a worktree, which the main workspace isn't. */
  function worktree(id: string) {
    const workspace = store.workspace(id);
    if (workspace.main || !workspace.branch)
      throw Error(
        'The project’s own folder isn’t a workspace that can be put away.',
      );
    return { workspace, branch: workspace.branch };
  }

  /**
   * Ends the workspace's panes, terminals and watching; returns the panes that were open
   * and can be reopened, in the order they were on screen.
   */
  async function close(workspace: WorkspaceView) {
    const order = store.state.layout.paneIds;
    const open = panes
      .openPanesOf(workspace)
      .toSorted((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    if (open.some((pane) => isRunning(pane.id)))
      throw Error(
        'Wait for the agents in this workspace to finish, or stop them, first.',
      );
    for (const pane of open) panes.archive(pane);
    terminals.closeWorkspace(workspace.id);
    await files.unwatch(workspace.id);
    return open.filter(isReopenable);
  }

  /** Puts the project's newest other worktree on screen in place of one going away; with none, nothing is shown. */
  function leave(workspace: WorkspaceView) {
    const project = store.project(workspace.projectId);
    if (project.lastWorkspaceId !== workspace.id) return;
    const next = store.state.workspaces
      .filter(
        (item) =>
          item.projectId === project.id &&
          item.id !== workspace.id &&
          !item.main &&
          item.status === 'in_progress',
      )
      .toSorted((a, b) => b.createdAt - a.createdAt)[0];
    if (next) store.workspaces.open(next);
  }

  /** The branches a task can start from, most recent first, and the default among them. */
  async function branches(projectId: string) {
    const repo = repository.projectFolder(projectId);
    const [names, fallback] = await Promise.all([
      git.branches(repo),
      git.defaultBranch(repo),
    ]);
    const current = await git.currentBranch(repo);
    return { branches: names, default: fallback ?? current };
  }

  /** The commit a new branch starts at: `origin`'s copy of `wanted` when there is one, else the local one. */
  async function startingPoint(repo: Place, wanted: string | undefined) {
    if (!wanted) return 'HEAD';
    if (await git.hasRef(repo, `refs/remotes/origin/${wanted}`))
      return `origin/${wanted}`;
    if (await git.hasRef(repo, `refs/heads/${wanted}`)) return wanted;
    return undefined;
  }

  async function create(
    projectId: string,
    { base: requested, request, open = true }: WorkspaceCreateInput = {},
  ) {
    const project = store.project(projectId);
    const repo = repository.projectFolder(project.id);
    if (!(await git.head(repo)).isGit)
      throw Error(
        `${project.name} isn’t a Git repository, so it can only be worked on in its own folder.`,
      );
    const prefix = await branchPrefix(repo);
    // Offline or without a remote, the branch starts from what the clone already has.
    await git.fetch(repo).catch(() => {});
    const target = requested ?? (await git.defaultBranch(repo));
    const base = await startingPoint(repo, target);
    if (!base) throw Error(`There is no branch called ${requested}.`);
    const { name, branch, path } = await freeName(project, repo, prefix);
    await git.addWorktree(repo, path, branch, base);
    const workspace = store.workspaces.add({
      id: randomUUID(),
      projectId: project.id,
      name,
      branch,
      path,
      main: false,
      status: 'in_progress',
      createdAt: Date.now(),
      base: target,
      request: request || undefined,
    });
    if (open) store.workspaces.open(workspace);
    await setUp(workspace);
    return workspace;
  }

  async function archive(id: string) {
    const { workspace } = worktree(id);
    if (workspace.status === 'archived') return;
    const repo = repository.projectFolder(workspace.projectId);
    const { machine, path } = resolvePlace(repository.folder(workspace.id));
    // Closing first, so no agent or terminal writes to the folder as it is saved.
    const open = await close(workspace);
    // A folder removed by hand has nothing left to save.
    if (await machine.exists(path)) {
      await runArchiveScript(workspace);
      await git.saveWorkingTree(
        repository.folder(workspace.id),
        archiveRef(workspace.id),
        `Bonfire archive of ${workspace.name}`,
      );
    }
    await git.removeWorktree(repo, workspace.path);
    store.workspaces.update(workspace, {
      status: 'archived',
      archivedPaneIds: open.map(({ id }) => id),
    });
  }

  async function unarchive(id: string) {
    const { workspace, branch } = worktree(id);
    if (workspace.status !== 'archived') return;
    const repo = repository.projectFolder(workspace.projectId);
    const reopen = workspace.archivedPaneIds ?? [];
    await git.addWorktree(repo, workspace.path, branch);
    const ref = archiveRef(workspace.id);
    if (await git.hasRef(repo, ref)) {
      await git.restoreWorkingTree(repository.folder(workspace.id), ref);
      await git.deleteRef(repo, ref);
    }
    store.workspaces.update(workspace, {
      status: 'in_progress',
      archivedPaneIds: undefined,
    });
    store.workspaces.open(workspace);
    // Each reopens at the front, so the last goes first to keep their order.
    for (const paneId of reopen.toReversed())
      try {
        panes.restore(store.pane(paneId));
      } catch (cause) {
        console.warn(`Could not reopen a pane: ${errorMessage(cause)}`);
      }
    await setUp(workspace);
  }

  /** Deletes the workspace: its folder, its branch, its saved work, and its panes. */
  async function remove(id: string) {
    const { workspace, branch } = worktree(id);
    const repo = repository.projectFolder(workspace.projectId);
    if (workspace.status !== 'archived') {
      await close(workspace);
      await git.removeWorktree(repo, workspace.path);
    }
    // A branch checked out elsewhere stays; only the app's hold on it goes.
    await git.deleteBranch(repo, branch).catch(() => {});
    await git.deleteRef(repo, archiveRef(workspace.id)).catch(() => {});
    leave(workspace);
    store.workspaces.remove(workspace);
  }

  /** Marks workspaces in progress done, such as when their pull request merged. */
  function markDone(ids: string[]) {
    let marked = false;
    for (const id of ids) {
      const workspace = store.state.workspaces.find((item) => item.id === id);
      if (workspace?.status !== 'in_progress' || workspace.main) continue;
      store.workspaces.update(workspace, { status: 'done' });
      marked = true;
    }
    if (marked) changed();
  }

  return {
    branches,
    create,
    open: (id: string) => store.workspaces.open(store.workspace(id)),
    rename: (id: string, title: string) =>
      store.workspaces.update(store.workspace(id), { title }),
    archive,
    unarchive,
    remove,
    markDone,
  };
}

export type Workspaces = ReturnType<typeof workspaceService>;
