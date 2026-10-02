<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import Icon from '$lib/components/icon/icon.svelte';
  import ProjectSwitcher from '../project-switcher/project-switcher.svelte';
  import { cn } from '$lib/utils';
  import type { Project } from '$shared/contracts';

  type HeaderAction = { icon: string; label: string; onclick?: () => void };

  let {
    projects,
    active,
    onselect,
    onaddProject,
    onremoveProject,
    onaddPane,
    onprevious,
    onnext,
    onhelp,
  }: {
    projects: Project[];
    active?: Project;
    onselect: (id: string) => void;
    onaddProject: () => void;
    onremoveProject: (id: string) => void;
    onaddPane: () => void;
    onprevious: () => void;
    onnext: () => void;
    onhelp: () => void;
  } = $props();

  const isMac = /mac/i.test(navigator.userAgent);
  let fullscreen = $state(false);

  const paneActions: HeaderAction[] = [
    { icon: 'plus', label: 'Add new pane', onclick: () => onaddPane() },
    {
      icon: 'chevron-left',
      label: 'Previous pane',
      onclick: () => onprevious(),
    },
    { icon: 'chevron-right', label: 'Next pane', onclick: () => onnext() },
  ];
  const utilityActions: HeaderAction[] = [
    { icon: 'help', label: 'Help', onclick: () => onhelp() },
    { icon: 'insights', label: 'Insights' },
    { icon: 'settings', label: 'Settings' },
  ];

  onMount(() => {
    window.bonfire.app.isFullscreen().then((value) => (fullscreen = value));
    return window.bonfire.app.onFullscreenChange(
      (value) => (fullscreen = value),
    );
  });
</script>

{#snippet actionButtons(actions: HeaderAction[], className?: string)}
  {#each actions as action (action.label)}
    <Button
      variant="secondary"
      size="icon"
      class={className}
      aria-label={action.label}
      onclick={action.onclick}
    >
      <Icon name={action.icon} />
    </Button>
  {/each}
{/snippet}

<header
  class={cn(
    'sticky top-0 z-20 flex min-h-13 shrink-0 items-center justify-between bg-background px-4 py-2 app-drag',
    isMac && !fullscreen && 'pl-22',
  )}
>
  <div class="flex items-center gap-3 app-no-drag">
    <ProjectSwitcher
      {projects}
      {active}
      {onselect}
      onadd={onaddProject}
      onremove={onremoveProject}
    />
    <span class="h-8.5 w-px bg-foreground/10" aria-hidden="true"></span>
    {@render actionButtons(paneActions)}
  </div>
  <div class="flex items-center gap-3 app-no-drag">
    {@render actionButtons(
      utilityActions,
      'text-muted-foreground hover:text-foreground',
    )}
  </div>
</header>
