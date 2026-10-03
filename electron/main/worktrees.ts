import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Project, Session } from '../../shared/contracts';
import { DEFAULT_FILES_TO_COPY, slugify } from '../../shared/domain';
import * as git from './git';
import {
  defaultShell,
  isWindows,
  terminalEnvironment,
  type WorkspaceEnvironment,
} from './shell';

/** First port handed out to workspaces; each gets the next free block of ten. */
const FIRST_PORT = 41_000;
const PORTS_PER_WORKSPACE = 10;
/** Copying stops here, so a broad pattern can't flood a new workspace. */
const MAX_FILES_TO_COPY = 500;
/** How long an archive script may run before it is stopped. */
const ARCHIVE_SCRIPT_TIMEOUT_MS = 60_000;

/** Where a project's workspaces live: `<root>/<project>-<id>/<name>`. */
export function worktreePath(root: string, project: Project, name: string) {
  const folder = `${slugify(project.name) || 'project'}-${project.id.slice(0, 4)}`;
  return join(root, folder, name);
}

/** The first block of ports no open workspace uses. */
export function freePort(sessions: Session[]) {
  const used = new Set(
    sessions.filter(({ archived }) => !archived).map(({ port }) => port),
  );
  let port = FIRST_PORT;
  while (used.has(port)) port += PORTS_PER_WORKSPACE;
  return port;
}

export function workspaceEnvironment(
  session: Session,
  project: Project,
  defaultBranch?: string,
): WorkspaceEnvironment {
  const environment: WorkspaceEnvironment = {
    BONFIRE_WORKSPACE_ID: session.id,
    BONFIRE_WORKSPACE_NAME: session.name ?? project.name,
    BONFIRE_WORKSPACE_PATH: session.worktreePath,
    BONFIRE_ROOT_PATH: project.path,
  };
  if (defaultBranch) environment.BONFIRE_DEFAULT_BRANCH = defaultBranch;
  if (session.port) environment.BONFIRE_PORT = String(session.port);
  return environment;
}

/**
 * The patterns of ignored files to copy into new workspaces: `.worktreeinclude` in the
 * project if there is one, else the project's setting, else `.env*`.
 */
export async function filesToCopyPatterns(project: Project) {
  const include = join(project.path, '.worktreeinclude');
  if (existsSync(include)) return readFile(include, 'utf8');
  return project.settings.filesToCopy?.trim() || DEFAULT_FILES_TO_COPY;
}

/**
 * Copies ignored files matching `patterns` from the project folder into the workspace,
 * such as `.env` files a fresh checkout lacks. Returns how many were copied.
 */
export async function copyIgnoredFiles(
  project: Project,
  destination: string,
  patterns: string,
) {
  const scratch = await mkdtemp(join(tmpdir(), 'bonfire-include-'));
  try {
    const patternsFile = join(scratch, 'patterns');
    await writeFile(patternsFile, patterns);
    const files = (
      await git.ignoredFilesMatching(project.path, patternsFile)
    ).slice(0, MAX_FILES_TO_COPY);
    for (const file of files) {
      const target = join(destination, file);
      if (existsSync(target)) continue;
      await cp(join(project.path, file), target, {
        recursive: true,
        errorOnExist: false,
      }).catch(() => {});
    }
    return files.length;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Runs a script to completion in a login shell, rejecting with its output if it fails. */
export function runScript(
  script: string,
  cwd: string,
  environment: WorkspaceEnvironment,
) {
  return new Promise<void>((resolve, reject) =>
    execFile(
      defaultShell(),
      isWindows() ? ['-Command', script] : ['-l', '-c', script],
      {
        cwd,
        env: { ...terminalEnvironment(), ...environment },
        timeout: ARCHIVE_SCRIPT_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (!error) return resolve();
        const output = `${stderr}${stdout}`.trim().split('\n').slice(-5);
        reject(Error([error.message.split('\n')[0], ...output].join('\n')));
      },
    ),
  );
}
