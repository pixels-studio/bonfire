import { randomUUID } from 'node:crypto';
import type {
  Pane,
  Project,
  RunScript,
  RunScriptInput,
  ScriptList,
  ScriptRun,
  ScriptSuggestion,
  TerminalEvent,
} from '../../shared/contracts';
import { quote, type Machine } from './machines';
import type { Store } from './persistence';
import type { Terminals } from './terminal';
import { sendable, type PaneView, type ProjectView } from './state';

/** Config files are small; anything bigger isn't one worth reading. */
const READ_LIMIT = 512 * 1024;

/** Package scripts that start a project, most likely first. */
const START_SCRIPTS = ['dev', 'start', 'serve', 'develop'];

/** How many detected scripts a project starts with; the rest stay suggestions. */
const SEEDED_SCRIPTS = 10;

/** How many workspace packages are looked into, so a huge monorepo stays quick. */
const MAX_PACKAGES = 40;

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

type PackageJson = {
  name?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
};

/** Reads the project's files, wherever its machine is. */
type Reader = {
  text(path: string): Promise<string | undefined>;
  folders(path: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
};

function reader(machine: Machine, root: string): Reader {
  const at = (path: string) => machine.path.join(root, path);
  return {
    text: (path) =>
      machine
        .readFile(at(path), READ_LIMIT)
        .then((data) => data.toString('utf8'))
        .catch(() => undefined),
    folders: (path) =>
      machine
        .readdir(at(path))
        .then((items) =>
          items
            .filter((item) => item.directory && !item.name.startsWith('.'))
            .map((item) => item.name)
            .sort(),
        )
        .catch(() => []),
    exists: (path) => machine.exists(at(path)).catch(() => false),
  };
}

function parseJson<T>(text: string | undefined): T | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** The package manager the repository uses: its `packageManager` field, else its lockfile. */
async function packageManager(
  files: Reader,
  manifest: PackageJson,
): Promise<PackageManager> {
  const declared = manifest.packageManager?.split('@')[0];
  if (declared === 'pnpm' || declared === 'yarn' || declared === 'bun')
    return declared;
  if (declared === 'npm') return 'npm';
  const lockfiles: [string, PackageManager][] = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
  ];
  const found = await Promise.all(
    lockfiles.map(([file]) => files.exists(file)),
  );
  return lockfiles.find((_, index) => found[index])?.[1] ?? 'npm';
}

/** The command that runs a package script at the root. */
export function rootCommand(manager: PackageManager, script: string) {
  if (manager === 'npm') return `npm run ${script}`;
  if (manager === 'bun') return `bun run ${script}`;
  return `${manager} ${script}`;
}

/** The command that runs a script of one workspace package, from the root. */
export function workspaceCommand(
  manager: PackageManager,
  script: string,
  pkg: { name?: string; folder: string },
) {
  if (!pkg.name)
    return `cd ${quote(pkg.folder)} && ${rootCommand(manager, script)}`;
  const name = quote(pkg.name);
  switch (manager) {
    case 'pnpm':
      return `pnpm --filter ${name} ${script}`;
    case 'yarn':
      return `yarn workspace ${name} ${script}`;
    case 'bun':
      return `bun run --filter ${name} ${script}`;
    default:
      return `npm run ${script} --workspace ${name}`;
  }
}

function startScript(manifest: PackageJson | undefined) {
  return START_SCRIPTS.find((name) => manifest?.scripts?.[name]);
}

/** The `packages:` globs of a `pnpm-workspace.yaml`; only the simple list form is read. */
export function pnpmWorkspaces(yaml: string) {
  const globs: string[] = [];
  let inPackages = false;
  for (const line of yaml.split('\n')) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const item = /^\s+-\s*['"]?([^'"#]+?)['"]?\s*(#.*)?$/.exec(line);
    if (item) globs.push(item[1]);
    else if (/^\S/.test(line)) break;
  }
  return globs;
}

/** The folders a workspace glob covers; `apps/*` and `apps/**` both mean the folders in `apps`. */
async function expandGlob(files: Reader, glob: string) {
  if (glob.startsWith('!')) return [];
  const clean = glob.replace(/^\.\//, '').replace(/\/+$/, '');
  const star = /^(.*?)\/\*\*?$/.exec(clean);
  if (!star) return clean.includes('*') ? [] : [clean];
  const parent = star[1];
  if (parent.includes('*')) return [];
  return (await files.folders(parent)).map((name) => `${parent}/${name}`);
}

/** Starting scripts of the packages in a JavaScript monorepo, one per package. */
async function workspaceScripts(
  files: Reader,
  manifest: PackageJson,
  manager: PackageManager,
): Promise<ScriptSuggestion[]> {
  const declared = Array.isArray(manifest.workspaces)
    ? manifest.workspaces
    : (manifest.workspaces?.packages ?? []);
  const yaml = await files.text('pnpm-workspace.yaml');
  const globs = [...declared, ...(yaml ? pnpmWorkspaces(yaml) : [])];
  if (!globs.length) return [];
  const excluded = new Set(
    globs.filter((glob) => glob.startsWith('!')).map((glob) => glob.slice(1)),
  );
  const folders = [
    ...new Set(
      (await Promise.all(globs.map((glob) => expandGlob(files, glob)))).flat(),
    ),
  ]
    .filter((folder) => !excluded.has(folder))
    .slice(0, MAX_PACKAGES);
  const packages = await Promise.all(
    folders.map(async (folder) => ({
      folder,
      manifest: parseJson<PackageJson>(
        await files.text(`${folder}/package.json`),
      ),
    })),
  );
  // Apps are what people run; libraries with a watch-mode `dev` come after.
  const isApp = (folder: string) => /^apps?\//.test(folder);
  return packages
    .filter(({ manifest: pkg }) => startScript(pkg))
    .sort(
      (first, second) =>
        Number(!isApp(first.folder)) - Number(!isApp(second.folder)),
    )
    .map(({ folder, manifest: pkg }) => ({
      name: folder.split('/').pop()!,
      command: workspaceCommand(manager, startScript(pkg)!, {
        name: pkg!.name,
        folder,
      }),
    }));
}

/** Make targets that start a project, if the Makefile has one. */
function makeTarget(makefile: string | undefined) {
  if (!makefile) return undefined;
  return ['dev', 'run', 'start', 'serve'].find((target) =>
    new RegExp(`^${target}\\s*:(?!=)`, 'm').test(makefile),
  );
}

/**
 * Commands that start the project, best first, read from its files: package scripts (and
 * one per app in a monorepo), `conductor.json`, and the usual entry points of other stacks.
 */
export async function detectScripts(
  machine: Machine,
  root: string,
): Promise<ScriptSuggestion[]> {
  const files = reader(machine, root);
  const [packageText, conductorText, denoText, denoCText, makefile, others] =
    await Promise.all([
      files.text('package.json'),
      files.text('conductor.json'),
      files.text('deno.json'),
      files.text('deno.jsonc'),
      files.text('Makefile'),
      Promise.all(
        [
          'bin/dev',
          'Cargo.toml',
          'go.mod',
          'manage.py',
          'Gemfile',
          'docker-compose.yml',
          'docker-compose.yaml',
          'compose.yml',
          'compose.yaml',
        ].map(async (file) => [file, await files.exists(file)] as const),
      ),
    ]);
  const present = new Set(
    others.filter(([, exists]) => exists).map(([file]) => file),
  );
  const suggestions: ScriptSuggestion[] = [];

  const conductor = parseJson<{ scripts?: { run?: string } }>(conductorText);
  if (conductor?.scripts?.run?.trim())
    suggestions.push({ name: 'Run', command: conductor.scripts.run.trim() });

  const manifest = parseJson<PackageJson>(packageText);
  if (manifest) {
    const manager = await packageManager(files, manifest);
    const packages = await workspaceScripts(files, manifest, manager);
    const script = startScript(manifest);
    if (script)
      suggestions.push({
        // In a monorepo the root script usually starts every app, as with Turborepo.
        name: packages.length
          ? 'All apps'
          : script === 'start'
            ? 'Start'
            : 'Dev server',
        command: rootCommand(manager, script),
      });
    suggestions.push(...packages);
  }

  const deno = parseJson<{ tasks?: Record<string, string> }>(
    denoText ?? denoCText,
  );
  const denoTask = START_SCRIPTS.find((name) => deno?.tasks?.[name]);
  if (denoTask)
    suggestions.push({ name: 'Dev server', command: `deno task ${denoTask}` });
  if (present.has('bin/dev'))
    suggestions.push({ name: 'Dev server', command: 'bin/dev' });
  else if (
    present.has('Gemfile') &&
    (await files.exists('config/application.rb'))
  )
    suggestions.push({ name: 'Rails server', command: 'bin/rails server' });
  if (present.has('manage.py'))
    suggestions.push({
      name: 'Django server',
      command: 'python manage.py runserver',
    });
  if (present.has('Cargo.toml'))
    suggestions.push({ name: 'Cargo run', command: 'cargo run' });
  if (present.has('go.mod'))
    suggestions.push({ name: 'Go run', command: 'go run .' });
  const target = makeTarget(makefile);
  if (target)
    suggestions.push({ name: `make ${target}`, command: `make ${target}` });
  if (
    [
      'docker-compose.yml',
      'docker-compose.yaml',
      'compose.yml',
      'compose.yaml',
    ].some((file) => present.has(file))
  )
    suggestions.push({ name: 'Docker Compose', command: 'docker compose up' });

  return uniqueNames(
    suggestions.filter(
      (suggestion, index) =>
        suggestions.findIndex(
          ({ command }) => command === suggestion.command,
        ) === index,
    ),
  );
}

/** Numbers repeated names, so `web` in `apps` and `examples` can be told apart. */
function uniqueNames(suggestions: ScriptSuggestion[]) {
  const seen = new Map<string, number>();
  return suggestions.map((suggestion) => {
    const count = (seen.get(suggestion.name) ?? 0) + 1;
    seen.set(suggestion.name, count);
    return count === 1
      ? suggestion
      : { ...suggestion, name: `${suggestion.name} ${count}` };
  });
}

type ScriptsOptions = {
  store: Store;
  terminals: Terminals;
  machine: (project: ProjectView) => Machine;
  /** Opens a terminal pane in the project for a script's output. */
  addPane: (project: ProjectView) => PaneView;
  /** Archives a pane, ending its terminal. */
  archivePane: (pane: PaneView) => void;
  emit: (run: ScriptRun) => void;
};

/** The projects' run scripts, and the processes running them. */
export class Scripts {
  /** The latest run of each script pane, by pane id. */
  private readonly runs = new Map<string, ScriptRun>();
  /** Detection in progress per project, so concurrent lists seed once. */
  private readonly seeding = new Map<string, Promise<void>>();

  constructor(private readonly options: ScriptsOptions) {}

  async list(projectId: string): Promise<ScriptList> {
    const project = this.options.store.project(projectId);
    if (!project.scripts) await this.seed(project);
    const scripts = sendable<RunScript[]>(project.scripts ?? []);
    return {
      scripts,
      selectedId: scripts.some(({ id }) => id === project.runScriptId)
        ? project.runScriptId
        : scripts[0]?.id,
    };
  }

  /** Gives a project the scripts its files suggest, the first time its scripts are asked for. */
  private seed(project: ProjectView) {
    let pending = this.seeding.get(project.id);
    if (!pending) {
      pending = this.detect(project.id)
        .catch(() => [])
        .then((suggestions) => {
          // Another call may have saved scripts in the meantime.
          if (project.scripts) return;
          this.options.store.projects.update(project, {
            scripts: suggestions
              .slice(0, SEEDED_SCRIPTS)
              .map((suggestion) => ({ id: randomUUID(), ...suggestion })),
          });
        })
        .finally(() => this.seeding.delete(project.id));
      this.seeding.set(project.id, pending);
    }
    return pending;
  }

  detect(projectId: string) {
    const project = this.options.store.project(projectId);
    return detectScripts(this.options.machine(project), project.path);
  }

  async save(projectId: string, input: RunScriptInput) {
    const project = this.options.store.project(projectId);
    if (!project.scripts) await this.seed(project);
    const { store } = this.options;
    const script: RunScript = {
      id: input.id ?? randomUUID(),
      name: input.name.trim(),
      command: input.command.trim(),
    };
    const scripts = [...(project.scripts ?? [])];
    const index = scripts.findIndex(({ id }) => id === script.id);
    if (index === -1) scripts.push(script);
    else scripts[index] = script;
    store.projects.update(project, { scripts });
    // An open pane keeps the script's name.
    const pane = this.paneOf(project, script.id);
    if (pane) store.panes.update(pane, { title: script.name });
    return script;
  }

  remove(projectId: string, scriptId: string) {
    const { store } = this.options;
    const project = store.project(projectId);
    store.projects.update(project, {
      scripts: project.scripts?.filter(({ id }) => id !== scriptId),
      ...(project.runScriptId === scriptId && { runScriptId: undefined }),
    });
    const pane = this.paneOf(project, scriptId);
    if (pane) this.options.archivePane(pane);
  }

  /** Runs a script in its pane, opening one if it has none, and restarting it if it runs. */
  async run(projectId: string, scriptId: string) {
    const { store, terminals } = this.options;
    const project = store.project(projectId);
    const script = project.scripts?.find(({ id }) => id === scriptId);
    if (!script) throw Error('That script was deleted.');
    let pane = this.paneOf(project, scriptId);
    if (!pane) {
      pane = this.options.addPane(project);
      // Reruns keep a title the user gave the pane.
      store.panes.update(pane, { scriptId: script.id, title: script.name });
    }
    store.projects.update(project, { runScriptId: script.id });
    const paneId = pane.id;
    const terminalId = await terminals.run(project.id, paneId, script.command);
    // The pane may have been closed while its previous run was stopping.
    if (pane.archived) {
      terminals.closePane(paneId);
      return paneId;
    }
    this.update({
      projectId: project.id,
      scriptId: script.id,
      paneId,
      terminalId,
      running: true,
    });
    return paneId;
  }

  async stop(projectId: string, scriptId: string) {
    const run = [...this.runs.values()].find(
      (item) => item.projectId === projectId && item.scriptId === scriptId,
    );
    if (run?.running) await this.options.terminals.stop(run.terminalId);
  }

  /** Runs of the project's open script panes. */
  activeRuns(projectId: string) {
    return [...this.runs.values()].filter(
      (run) => run.projectId === projectId && this.isOpen(run.paneId),
    );
  }

  /** Notes a script's process ending, from the terminal events. */
  handle(event: TerminalEvent) {
    if (event.exitCode === undefined) return;
    for (const run of this.runs.values())
      if (run.terminalId === event.terminalId && run.running)
        this.update({ ...run, running: false, exitCode: event.exitCode });
  }

  /** Forgets runs of panes that were closed. */
  forgetPane(paneId: string) {
    const run = this.runs.get(paneId);
    if (!run) return;
    this.runs.delete(paneId);
    this.options.emit({ ...run, running: false });
  }

  private update(run: ScriptRun) {
    this.runs.set(run.paneId, run);
    this.options.emit(run);
  }

  private isOpen(paneId: string) {
    return this.options.store.state.panes.some(
      (pane) => pane.id === paneId && !pane.archived,
    );
  }

  private paneOf(project: ProjectView, scriptId: string) {
    return this.options.store.state.panes.find(
      (pane) =>
        pane.projectId === project.id &&
        pane.scriptId === scriptId &&
        !pane.archived,
    );
  }
}
