import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { Entry, FileChangeEvent } from '../../shared/contracts';
import { git } from './git';

const HIDDEN_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.svelte-kit',
]);
const PREVIEW_LIMIT_BYTES = 2 * 1024 * 1024;
const WATCH_DEPTH = 3;

/** Resolves `path` inside `root`, rejecting escapes (incl. via symlinks) and Git metadata. */
export async function safePath(root: string, path: string) {
  const base = await realpath(root);
  const target = await realpath(resolve(base, path));
  const relativePath = relative(base, target);
  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath) ||
    relativePath.split(sep).includes('.git')
  )
    throw Error('Path is outside the workspace or is Git metadata');
  return target;
}

export class Filesystem {
  private readonly watchers = new Map<string, FSWatcher>();

  async list(root: string, path: string): Promise<Entry[]> {
    const directory = await safePath(root, path);
    const items = await readdir(directory, { withFileTypes: true });
    const ignored = await gitIgnored(root, directory);
    return items
      .filter(
        (item) =>
          !HIDDEN_DIRECTORIES.has(item.name) &&
          !item.isSymbolicLink() &&
          !ignored.has(relative(root, resolve(directory, item.name))),
      )
      .map((item) => ({ name: item.name, directory: item.isDirectory() }))
      .sort(
        (first, second) =>
          Number(second.directory) - Number(first.directory) ||
          first.name.localeCompare(second.name),
      );
  }

  async read(root: string, path: string) {
    const target = await safePath(root, path);
    if ((await stat(target)).size > PREVIEW_LIMIT_BYTES)
      throw Error('Preview limited to 2 MB');
    const data = await readFile(target);
    if (data.includes(0)) throw Error('Binary file; text previews only');
    return data.toString('utf8');
  }

  watch(
    sessionId: string,
    root: string,
    emit: (event: FileChangeEvent) => void,
  ) {
    if (this.watchers.has(sessionId)) return;
    const watcher = watch(root, {
      ignoreInitial: true,
      depth: WATCH_DEPTH,
      followSymlinks: false,
      ignored: (path) =>
        path.split(/[\\/]/).some((segment) => HIDDEN_DIRECTORIES.has(segment)),
    });
    watcher.on('all', (_eventName, path) =>
      emit({ sessionId, path: relative(root, path) }),
    );
    watcher.on('error', (error) => console.error('Watcher:', error));
    this.watchers.set(sessionId, watcher);
  }

  async unwatch(sessionId: string) {
    await this.watchers.get(sessionId)?.close();
    this.watchers.delete(sessionId);
  }

  async close() {
    await Promise.all([...this.watchers.keys()].map((id) => this.unwatch(id)));
  }
}

async function gitIgnored(root: string, directory: string) {
  const output = await git(root, [
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-standard',
    '--directory',
    '-z',
    '--',
    relative(root, directory) || '.',
  ]).catch(() => '');
  return new Set(output.split('\0').map((path) => path.replace(/\/$/, '')));
}
