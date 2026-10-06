<script lang="ts">
  import { overlayScrollbar } from '$lib/scrollbar';
  import * as Card from '$lib/components/ui/card';
  import { Textarea } from '$lib/components/ui/input';
  import PaneHeader from '$lib/components/pane-header/pane-header.svelte';
  import Setting from '$lib/components/settings/setting.svelte';
  import type { PanelProps } from '$lib/panes';
  import { toast } from '$lib/stores/toast.svelte';
  import type { BonfireConfig, Project } from '$shared/contracts';
  import { errorMessage } from '$shared/domain';

  let {
    project,
    onsaved,
    onclose,
  }: PanelProps & {
    project: Project;
    /** The settings were saved, so the project's copy is out of date. */
    onsaved: () => void;
  } = $props();

  /** What the repository's `bonfire.json` asks for, which these settings override. */
  let config = $state<BonfireConfig>({});

  $effect(() => {
    const id = project.id;
    config = {};
    window.bonfire.projects
      .config(id)
      .then((found) => {
        if (id === project.id) config = found;
      })
      .catch(() => {});
  });

  const SCRIPTS = [
    {
      key: 'setupScript',
      config: 'setup',
      title: 'Setup script',
      description:
        'Runs in each new workspace, and again when one is unarchived, such as to install dependencies or copy .env files. BONFIRE_ROOT_PATH is the project folder.',
    },
    {
      key: 'archiveScript',
      config: 'archive',
      title: 'Archive script',
      description:
        'Runs in a workspace before it is archived, such as to stop its servers or clean up. Archiving goes ahead if it fails.',
    },
  ] as const;

  /** Saves a script as typed; an empty box goes back to the repository's `bonfire.json`. */
  async function commit(key: (typeof SCRIPTS)[number]['key'], text: string) {
    const value = text.trim();
    if (value === (project[key] ?? '')) return;
    try {
      await window.bonfire.projects.update(project.id, {
        setupScript: project.setupScript ?? '',
        archiveScript: project.archiveScript ?? '',
        [key]: value,
      });
      onsaved();
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error', duration: 0 });
    }
  }
</script>

<Card.Root
  class="h-full min-w-0 gap-0"
  role="region"
  aria-label={`${project.name} settings`}
>
  <PaneHeader title={`${project.name} settings`} icon="project" {onclose} />
  <div
    {@attach overlayScrollbar}
    class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-4 pb-6"
  >
    <p class="text-sm text-pretty text-muted-foreground">
      Each workspace is a Git worktree of {project.name} on a branch of its own. A
      <code class="font-mono text-xs text-foreground">bonfire.json</code>
      in the repository can share these scripts with your team, as
      <code class="font-mono text-xs text-foreground"
        >{'{ "scripts": { "setup": "…", "archive": "…" } }'}</code
      >; what you set here takes its place on this computer.
    </p>
    {#each SCRIPTS as script (script.key)}
      <Setting title={script.title} description={script.description}>
        {#snippet control(props)}
          <Textarea
            {...props}
            class="min-h-24 resize-y font-mono text-xs"
            rows={4}
            spellcheck="false"
            placeholder={config[script.config] ??
              (script.key === 'setupScript' ? 'npm install' : '')}
            value={project[script.key] ?? ''}
            onblur={(event) =>
              void commit(script.key, event.currentTarget.value)}
          />
        {/snippet}
      </Setting>
      {#if config[script.config] && !project[script.key]}
        <p class="-mt-4 text-xs text-muted-foreground">
          Using the repository’s bonfire.json.
        </p>
      {/if}
    {/each}
  </div>
</Card.Root>
