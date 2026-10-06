import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  ProjectCloneInput,
  ProjectCreateInput,
} from '../../../shared/contracts';
import {
  cloneUrl,
  errorMessage,
  folderName,
  repositoryName,
} from '../../../shared/domain';
import type { Filesystem } from '../filesystem';
import * as git from '../git';
import { localMachine, type Machines } from '../machines';
import type { Store } from '../persistence';
import type { Terminals } from '../terminal';
import type { Panes } from './panes';

type ProjectOptions = {
  store: Store;
  machines: Machines;
  files: Filesystem;
  terminals: Terminals;
  panes: Panes;
};

/** Folders in the home folder where people tend to keep their code, most likely first. */
const CODE_FOLDERS = ['Developer', 'Projects', 'Code', 'code', 'src', 'dev'];

/** Adding, cloning, opening and removing projects. */
export function projectService({
  store,
  machines,
  files,
  terminals,
  panes,
}: ProjectOptions) {
  /** Adds a folder as a project, or finds the project it already is, and opens it. */
  async function create({ name, path, connectionId }: ProjectCreateInput) {
    const machine = machines.get(connectionId);
    const home = await machine.home();
    const expanded =
      path === '~' || path.startsWith('~/')
        ? machine.path.join(home, path.slice(1))
        : path;
    let resolved: string;
    try {
      resolved = await machine.realpath(expanded);
      await machine.readdir(resolved);
    } catch (cause) {
      throw Error(`Could not open ${path}: ${errorMessage(cause)}`);
    }
    const project =
      store.state.projects.find(
        (item) => item.path === resolved && item.connectionId === connectionId,
      ) ??
      store.projects.add({
        id: randomUUID(),
        name: name.trim() || folderName(resolved),
        path: resolved,
        connectionId,
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
      });
    store.projects.open(project);
    return project;
  }

  /** Where clones go by default: the first code folder that exists, else ~/Developer. */
  async function cloneFolder() {
    for (const name of CODE_FOLDERS) {
      const path = join(homedir(), name);
      if (await localMachine.exists(path)) return path;
    }
    return join(homedir(), CODE_FOLDERS[0]);
  }

  /** Clones a repository into a new folder inside `parent`, then adds it as a project. */
  async function clone({ url, parent }: ProjectCloneInput) {
    const resolvedUrl = cloneUrl(url);
    if (!resolvedUrl) throw Error(`${url} isn't a repository URL.`);
    const name = repositoryName(resolvedUrl);
    if (!name || name === '.' || name === '..')
      throw Error(`Could not name a folder after ${url}.`);
    const base =
      parent === '~' || parent.startsWith('~/')
        ? join(homedir(), parent.slice(1))
        : parent;
    const path = join(base, name);
    if (await localMachine.exists(path))
      throw Error(
        `${path} already exists. Choose another folder, or add it as an existing folder.`,
      );
    await git.clone(resolvedUrl, path);
    return create({ name, path });
  }

  async function remove(id: string) {
    const project = store.project(id);
    for (const pane of panes.openPanesOf(project)) panes.archive(pane);
    terminals.closeProject(project.id);
    await files.unwatch(project.id);
    store.projects.remove(project);
  }

  return {
    create,
    clone,
    cloneFolder,
    open: (id: string) => store.projects.open(store.project(id)),
    remove,
  };
}
