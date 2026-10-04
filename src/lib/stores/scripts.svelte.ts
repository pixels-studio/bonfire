import type {
  RunScript,
  RunScriptInput,
  ScriptRun,
  ScriptSuggestion,
} from '$shared/contracts';
import { errorMessage } from '$shared/domain';
import { toast } from './toast.svelte';

function showError(cause: unknown) {
  toast(errorMessage(cause), { variant: 'error', duration: 0 });
}

/** The run scripts of the project on screen, and their processes, kept current while watched. */
class ScriptsStore {
  /** `undefined` until loaded. */
  list = $state<RunScript[]>();
  /** The script the Run button starts. */
  selectedId = $state<string>();
  /** The latest run of each script pane, by pane id. */
  runs = $state<Record<string, ScriptRun>>({});
  /** Scripts being started or stopped, which their buttons show. */
  pending = $state<Record<string, boolean>>({});
  readonly selected = $derived(
    this.list?.find(({ id }) => id === this.selectedId) ?? this.list?.[0],
  );
  private projectId?: string;
  private generation = 0;

  /** Told of the pane a script runs in, to bring it on screen. */
  onPane?: (paneId: string) => void | Promise<void>;
  /** Told when panes changed, such as a deleted script's pane closing. */
  onPanesChanged?: () => void | Promise<void>;

  /** Follows a project, or none; returns what stops it. */
  watch(projectId: string | undefined) {
    this.projectId = projectId;
    this.list = undefined;
    this.selectedId = undefined;
    this.runs = {};
    this.pending = {};
    if (!projectId) return;
    void this.reload();
    return window.bonfire.scripts.onRun((run) => {
      if (run.projectId === this.projectId) this.runs[run.paneId] = run;
    });
  }

  async reload() {
    const projectId = this.projectId;
    if (!projectId) return;
    const token = ++this.generation;
    try {
      const [{ scripts, selectedId }, runs] = await Promise.all([
        window.bonfire.scripts.list(projectId),
        window.bonfire.scripts.runs(projectId),
      ]);
      if (token !== this.generation) return;
      this.list = scripts;
      this.selectedId = selectedId;
      this.runs = Object.fromEntries(runs.map((run) => [run.paneId, run]));
    } catch (cause) {
      if (token === this.generation) this.list ??= [];
      showError(cause);
    }
  }

  /** The script's latest run, if it has run since the app started. */
  runOf(scriptId: string) {
    return Object.values(this.runs).find((run) => run.scriptId === scriptId);
  }

  runOfPane(paneId: string) {
    return this.runs[paneId] as ScriptRun | undefined;
  }

  isRunning(scriptId: string) {
    return !!this.runOf(scriptId)?.running;
  }

  /** Scripts found in the project's files, for the add dialog to offer. */
  async detect(): Promise<ScriptSuggestion[]> {
    if (!this.projectId) return [];
    return window.bonfire.scripts.detect(this.projectId).catch(() => []);
  }

  async run(scriptId: string) {
    const projectId = this.projectId;
    if (!projectId || this.pending[scriptId]) return;
    this.pending[scriptId] = true;
    this.selectedId = scriptId;
    try {
      const paneId = await window.bonfire.scripts.run(projectId, scriptId);
      await this.onPane?.(paneId);
    } catch (cause) {
      showError(cause);
    } finally {
      this.pending[scriptId] = false;
    }
  }

  /** Scripts of the project that are running now. */
  readonly running = $derived(
    (this.list ?? []).filter((script) =>
      Object.values(this.runs).some(
        (run) => run.scriptId === script.id && run.running,
      ),
    ),
  );

  /** Stops every running script of the project at once. */
  async stopAll() {
    await Promise.all(this.running.map(({ id }) => this.stop(id)));
  }

  async stop(scriptId: string) {
    const projectId = this.projectId;
    if (!projectId || this.pending[scriptId]) return;
    this.pending[scriptId] = true;
    try {
      await window.bonfire.scripts.stop(projectId, scriptId);
    } catch (cause) {
      showError(cause);
    } finally {
      this.pending[scriptId] = false;
    }
  }

  async save(input: RunScriptInput) {
    const projectId = this.projectId;
    if (!projectId) return;
    const script = await window.bonfire.scripts.save(projectId, input);
    if (projectId !== this.projectId) return;
    const list = this.list ?? [];
    const index = list.findIndex(({ id }) => id === script.id);
    this.list = index === -1 ? [...list, script] : list.with(index, script);
    // A renamed script renames its pane.
    if (index !== -1) await this.onPanesChanged?.();
    return script;
  }

  async remove(scriptId: string) {
    const projectId = this.projectId;
    if (!projectId) return;
    try {
      await window.bonfire.scripts.remove(projectId, scriptId);
      this.list = this.list?.filter(({ id }) => id !== scriptId);
      if (this.selectedId === scriptId) this.selectedId = undefined;
      await this.onPanesChanged?.();
    } catch (cause) {
      showError(cause);
    }
  }
}

export const scripts = new ScriptsStore();
