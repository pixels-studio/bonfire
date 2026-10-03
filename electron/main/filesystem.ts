import { access, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
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

  /** Paths of files in the workspace matching `query`, skipping hidden and git-ignored ones. */
  async search(root: string, query: string): Promise<string[]> {
    const matches = rankFiles(
      await listFiles(root),
      query,
      SEARCH_RESULT_LIMIT * 2,
    );
    // `git ls-files` still lists tracked files that were deleted from disk.
    const present = await Promise.all(
      matches.map((path) =>
        access(resolve(root, path)).then(
          () => true,
          () => false,
        ),
      ),
    );
    return matches
      .filter((_, index) => present[index])
      .slice(0, SEARCH_RESULT_LIMIT);
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

async function listFiles(root: string) {
  const output = await git(root, [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
  ]).catch(() => undefined);
  const paths =
    output === undefined
      ? await walk(root)
      : output.split('\0').filter(Boolean);
  return paths.filter(
    (path) => !path.split('/').some((part) => HIDDEN_DIRECTORIES.has(part)),
  );
}

/** Fallback for folders that are not Git repositories. */
async function walk(root: string) {
  const files: string[] = [];
  const pending = [''];
  while (pending.length && files.length < WALK_FILE_LIMIT) {
    const directory = pending.pop()!;
    const items = await readdir(resolve(root, directory), {
      withFileTypes: true,
    }).catch(() => []);
    for (const item of items) {
      if (HIDDEN_DIRECTORIES.has(item.name) || item.isSymbolicLink()) continue;
      const path = directory ? `${directory}/${item.name}` : item.name;
      if (item.isDirectory()) pending.push(path);
      else files.push(path);
    }
  }
  return files;
}
