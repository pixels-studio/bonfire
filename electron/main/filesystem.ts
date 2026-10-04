import { homedir } from 'node:os';
import { basename } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
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
const WATCH_DEPTH = 3;
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
  private readonly watchers = new Map<string, FSWatcher>();

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

  /** Reports changes to files on this computer; remote folders aren't watched. */
  watch(
    projectId: string,
    root: Place,
    emit: (event: FileChangeEvent) => void,
  ) {
    const { machine, path: rootPath } = resolvePlace(root);
    if (machine.remote || this.watchers.has(projectId)) return;
    // Watching the whole disk or home folder would reach into Music, Photos, and Contacts,
    // which macOS guards with a prompt each, for changes no pane needs.
    if (rootPath === '/' || rootPath === homedir()) return;
    const { relative } = machine.path;
    const watcher = watch(rootPath, {
      ignoreInitial: true,
      depth: WATCH_DEPTH,
      followSymlinks: false,
      ignored: (path) =>
        path
          .split(/[\\/]/)
          .some(
            (segment) =>
              HIDDEN_DIRECTORIES.has(segment) || MEDIA_LIBRARY.test(segment),
          ),
    });
    watcher.on('all', (_eventName, path) =>
      emit({ projectId, path: relative(rootPath, path) }),
    );
    watcher.on('error', (error) => console.error('Watcher:', error));
    this.watchers.set(projectId, watcher);
  }

  async unwatch(projectId: string) {
    await this.watchers.get(projectId)?.close();
    this.watchers.delete(projectId);
  }

  async close() {
    await Promise.all([...this.watchers.keys()].map((id) => this.unwatch(id)));
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
