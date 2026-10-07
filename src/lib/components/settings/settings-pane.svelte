<script lang="ts">
  import { overlayScrollbar } from '$lib/scrollbar';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import Icon from '$lib/components/icon/icon.svelte';
  import PaneHeader from '$lib/components/pane-header/pane-header.svelte';
  import ProjectSettings from '$lib/components/project-settings/project-settings.svelte';
  import type { PanelProps } from '$lib/panes';
  import type { Project } from '$shared/contracts';
  import SettingsPanel from './settings-panel.svelte';

  let {
    projects,
    onsaved,
    onremove,
    onclose,
  }: PanelProps & {
    projects: Project[];
    onsaved: () => void;
    onremove: (id: string) => void;
  } = $props();

  /** The project whose own settings are showing instead of the global ones. */
  let selectedId = $state<string>();
  const selected = $derived(projects.find((item) => item.id === selectedId));
</script>

<Card.Root class="h-full min-w-0 gap-0" role="region" aria-label="Settings">
  <PaneHeader
    title={selected ? `${selected.name} settings` : 'Settings'}
    icon={selected ? 'project' : 'settings'}
    {onclose}
  />
  <div
    {@attach overlayScrollbar}
    class="min-h-0 flex-1 overflow-y-auto overscroll-contain"
  >
    {#if selected}
      <div class="px-4 pb-4">
        <Button
          variant="ghost"
          size="sm"
          class="-ml-2 text-muted-foreground hover:text-foreground"
          onclick={() => (selectedId = undefined)}
        >
          <Icon name="arrow-left" /> All settings
        </Button>
      </div>
      <ProjectSettings
        project={selected}
        {onsaved}
        onremove={(id) => {
          selectedId = undefined;
          onremove(id);
        }}
      />
    {:else}
      <SettingsPanel {projects} onproject={(id) => (selectedId = id)} />
    {/if}
  </div>
</Card.Root>
