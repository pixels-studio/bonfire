import { watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { basename } from 'node:path';
import type { Entry, FileChangeEvent } from '../../shared/contracts';
import { git } from './git';
import {
  FileTooLargeError,
  resolvePlace,
  type Machine,
  type Place,
} from './machines';

/** Photos, Music, and TV libraries, which macOS asks permission to read. */
const MEDIA_LIBRARY = /\.(photoslibrary|musiclibrary|tvlibrary|photolibrary)$/i;
const HIDDEN_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.svelte-kit',
]);
const PREVIEW_LIMIT_BYTES = 2 * 1024 * 1024;
/** A burst of changes is reported once it settles, or after this long while it goes on. */
const CHANGE_QUIET_MS = 150;
const CHANGE_MAX_WAIT_MS = 1000;
export const SEARCH_RESULT_LIMIT = 100;
const WALK_FILE_LIMIT = 20_000;

/** Files whose path holds every word of `query`, best first: name matches, then shorter paths. */
export function rankFiles(paths: string[], query: string, limit: number) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const ranked: { path: string; score: number }[] = [];
  for (const path of paths) {
    const lower = path.toLowerCase();
    if (!words.every((word) => lower.includes(word))) continue;
    const name = basename(lower);
    const inName = words.every((word) => name.includes(word));
    const prefix = inName && name.startsWith(words[0]);
    ranked.push({
      path,
      score: (prefix ? 0 : inName ? 1 : 2) * 10_000 + path.length,
    });
  }
  return ranked
    .sort((a, b) => a.score - b.score || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((item) => item.path);
}

/** Resolves `path` inside `root`, rejecting escapes (incl. via symlinks) and Git metadata. */
export async function safePath(root: Place, path: string) {
  const { machine, path: rootPath } = resolvePlace(root);
  const { isAbsolute, relative, resolve, sep } = machine.path;
  const base = await machine.realpath(rootPath);
  const target = await machine.realpath(resolve(base, path));
  const relativePath = relative(base, target);
  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath) ||
    relativePath.split(sep).includes('.git')
  )
    throw Error('Path is outside the project or is Git metadata');
  return target;
}

export class Filesystem {
  private readonly watchers = new Map<string, FolderWatch>();

  async list(root: Place, path: string): Promise<Entry[]> {
    const { machine, path: rootPath } = resolvePlace(root);
    const { relative, resolve } = machine.path;
    const directory = await safePath(root, path);
    const items = await machine.readdir(directory);
    const ignored = await gitIgnored(root, relative(rootPath, directory));
    return items
      .filter(
        (item) =>
          !HIDDEN_DIRECTORIES.has(item.name) &&
          !item.symlink &&
          !ignored.has(relative(rootPath, resolve(directory, item.name))),
      )
      .map((item) => ({ name: item.name, directory: item.directory }))
      .sort(
        (first, second) =>
          Number(second.directory) - Number(first.directory) ||
          first.name.localeCompare(second.name),
      );
  }

  /** Paths of files in the project matching `query`, skipping hidden and git-ignored ones. */
  async search(root: Place, query: string): Promise<string[]> {
    return rankFiles(await listFiles(root), query, SEARCH_RESULT_LIMIT);
  }

  async read(root: Place, path: string) {
    const { machine } = resolvePlace(root);
    const target = await safePath(root, path);
    let data: Buffer;
    try {
      data = await machine.readFile(target, PREVIEW_LIMIT_BYTES);
    } catch (cause) {
      if (cause instanceof FileTooLargeError)
        throw Error('Preview limited to 2 MB');
      throw cause;
    }
    if (data.includes(0)) throw Error('Binary file; text previews only');
    return data.toString('utf8');
  }

  /**
   * Reports changes to the files of a folder on this computer, and to what Git has checked
   * out, staged, and committed there. Returns whether changes will be reported; remote
   * folders aren't watched, so their views check back instead.
   */
  watch(
    workspaceId: string,
    root: Place,
    emit: (event: FileChangeEvent) => void,
  ) {
    if (this.watchers.has(workspaceId)) return true;
    const { machine, path: rootPath } = resolvePlace(root);
    if (machine.remote) return false;
    // Watching the whole disk or home folder would reach into Music, Photos, and Contacts,
    // which macOS guards with a prompt each, for changes no pane needs.
    if (rootPath === '/' || rootPath === homedir()) return false;
    const folder = new FolderWatch((kind) => emit({ workspaceId, kind }));
    try {
      folder.watchFolder(rootPath);
    } catch (cause) {
      console.error('Watcher:', cause);
      folder.close();
      return false;
    }
    void folder.watchGit(root);
    this.watchers.set(workspaceId, folder);
    return true;
  }

  async unwatch(workspaceId: string) {
    this.watchers.get(workspaceId)?.close();
    this.watchers.delete(workspaceId);
  }

  async close() {
    for (const id of [...this.watchers.keys()]) await this.unwatch(id);
  }
}

type ChangeKind = FileChangeEvent['kind'];

/** Whether a path in the project, relative to it, is one no view shows. */
function isHidden(path: string) {
  return path
    .split(/[\\/]/)
    .some(
      (segment) =>
        HIDDEN_DIRECTORIES.has(segment) || MEDIA_LIBRARY.test(segment),
    );
}

/**
 * What Git's own folder holds that the app shows: `HEAD`, the branch checked out; `index`,
 * what is staged; and the refs, which commits, pushes, and fetches move. Git writes each by
 * renaming a lock file over it, so folders are watched rather than files.
 */
function gitChange(path: string, { refs = true, head = true } = {}) {
  const [first] = path.split(/[\\/]/);
  if (head && path === 'HEAD') return 'head';
  if (head && path === 'index') return 'files';
  if (refs && (first === 'refs' || path === 'packed-refs')) return 'refs';
  return undefined;
}

/**
 * The OS's own watchers on one folder: one for the whole folder, however deep, and one or
 * two for Git's. Changes come in bursts, a checkout touching thousands of files, so each
 * kind is reported once a burst settles, or every so often while it goes on.
 */
class FolderWatch {
  private readonly watchers: FSWatcher[] = [];
  private readonly pending = new Map<
    ChangeKind,
    { since: number; timer: NodeJS.Timeout }
  >();
  private closed = false;

  constructor(private readonly emit: (kind: ChangeKind) => void) {}

  watchFolder(path: string) {
    this.add(path, true, (file) => (isHidden(file) ? undefined : 'files'));
  }

  /** A worktree keeps its HEAD and index in its own Git folder, and its refs in the shared one. */
  async watchGit(root: Place) {
    const output = await git(root, [
      'rev-parse',
      '--path-format=absolute',
      '--git-dir',
      '--git-common-dir',
    ]).catch(() => undefined);
    if (!output || this.closed) return;
    const [gitDirectory, commonDirectory] = output.trim().split(/\r?\n/);
    try {
      if (gitDirectory === commonDirectory)
        this.add(gitDirectory, true, (path) => gitChange(path));
      else {
        this.add(gitDirectory, false, (path) =>
          gitChange(path, { refs: false }),
        );
        this.add(commonDirectory, true, (path) =>
          gitChange(path, { head: false }),
        );
      }
    } catch (cause) {
      // The folder's own changes are still reported; only Git's are missed.
      console.error('Git watcher:', cause);
    }
  }

  close() {
    this.closed = true;
    for (const watcher of this.watchers) watcher.close();
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  private add(
    path: string,
    recursive: boolean,
    classify: (relativePath: string) => ChangeKind | undefined,
  ) {
    const watcher = watch(path, { recursive }, (_event, file) => {
      const kind = file ? classify(file) : 'files';
      if (kind) this.changed(kind);
    });
    watcher.on('error', (error) => console.error('Watcher:', error));
    this.watchers.push(watcher);
  }

  private changed(kind: ChangeKind) {
    const now = Date.now();
    const pending = this.pending.get(kind);
    const since = pending?.since ?? now;
    clearTimeout(pending?.timer);
    const timer = setTimeout(
      () => {
        this.pending.delete(kind);
        this.emit(kind);
      },
      Math.min(CHANGE_QUIET_MS, since + CHANGE_MAX_WAIT_MS - now),
    );
    this.pending.set(kind, { since, timer });
  }
}

/** Ignored paths in the folder at `directory`, relative to the root. */
async function gitIgnored(root: Place, directory: string) {
  const output = await git(root, [
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-standard',
    '--directory',
    '-z',
    '--',
    directory || '.',
  ]).catch(() => '');
  return new Set(output.split('\0').map((path) => path.replace(/\/$/, '')));
}

const records = (output: string) => output.split('\0').filter(Boolean);

async function listFiles(root: Place) {
  const listed = await Promise.all([
    git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']),
    // Tracked files deleted from disk are still listed as cached.
    git(root, ['ls-files', '--deleted', '-z']),
  ]).catch(() => undefined);
  let paths: string[];
  if (listed) {
    const deleted = new Set(records(listed[1]));
    paths = records(listed[0]).filter((path) => !deleted.has(path));
  } else {
    const { machine, path } = resolvePlace(root);
    paths = await walk(machine, path);
  }
  return paths.filter(
    (path) => !path.split('/').some((part) => HIDDEN_DIRECTORIES.has(part)),
  );
}

/** Fallback for folders that are not Git repositories. */
async function walk(machine: Machine, root: string) {
  const files: string[] = [];
  const pending = [''];
  while (pending.length && files.length < WALK_FILE_LIMIT) {
    const directory = pending.pop()!;
    const items = await machine
      .readdir(machine.path.resolve(root, directory))
      .catch(() => []);
    for (const item of items) {
      if (HIDDEN_DIRECTORIES.has(item.name) || item.symlink) continue;
      const path = directory ? `${directory}/${item.name}` : item.name;
      if (item.directory) pending.push(path);
      else files.push(path);
    }
  }
  return files;
}
