<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import Icon from '$lib/components/icon/icon.svelte';
  import ProjectSwitcher from '../project-switcher/project-switcher.svelte';
  import type { Project } from '$shared/contracts';

  let isMac = $state(false);
  let fullscreen = $state(false);
  onMount(() => {
    isMac = /mac/i.test(navigator.userAgent);
    void window.bonfire.app.isFullscreen().then((value) => (fullscreen = value));
    return window.bonfire.app.onFullscreenChange((value) => (fullscreen = value));
  });

  let {
    projects,
    active,
    onselect,
    onaddProject,
    onaddPane,
    onprevious,
    onnext,
    onhelp,
  }: {
    projects: Project[];
    active?: Project;
    onselect: (id: string) => void;
    onaddProject: () => void;
    onaddPane: (type: 'claude' | 'codex') => void;
    onprevious: () => void;
    onnext: () => void;
    onhelp: () => void;
  } = $props();
</script>

<header class="app-header" class:traffic-lights={isMac && !fullscreen}>
  <div class="header-group">
    <ProjectSwitcher {projects} {active} {onselect} onadd={onaddProject} />
    <span class="divider" aria-hidden="true"></span>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}<Button {...props} variant="secondary" size="icon" aria-label="Add new pane"><Icon name="plus" /></Button>{/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start">
        <DropdownMenu.Item onclick={() => onaddPane('claude')}
          ><Icon name="claude" /> Claude</DropdownMenu.Item
        >
        <DropdownMenu.Item onclick={() => onaddPane('codex')}
          ><Icon name="codex" /> Codex</DropdownMenu.Item
        >
      </DropdownMenu.Content>
    </DropdownMenu.Root>
    <Button variant="secondary" size="icon" aria-label="Previous pane" onclick={onprevious}><Icon name="chevron-left" /></Button>
    <Button variant="secondary" size="icon" aria-label="Next pane" onclick={onnext}><Icon name="chevron-right" /></Button>
  </div>
  <div class="header-group utility-actions">
    <Button variant="secondary" size="icon" aria-label="Help" onclick={onhelp}><Icon name="help" /></Button>
    <Button variant="secondary" size="icon" aria-label="Insights"><Icon name="insights" /></Button>
    <Button variant="secondary" size="icon" aria-label="Settings"><Icon name="settings" /></Button>
  </div>
</header>

<style>
  .app-header {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 52px;
    padding: 8px 16px;
    background: var(--background);
    -webkit-app-region: drag;
  }
  .app-header.traffic-lights {
    padding-left: 88px;
  }
  .header-group {
    display: flex;
    align-items: center;
    gap: 12px;
    -webkit-app-region: no-drag;
  }
  .divider {
    align-self: stretch;
    width: 1px;
    background: color-mix(in srgb, var(--foreground) 8%, transparent);
  }
  .utility-actions :global(button) {
    color: var(--foreground-subtle);
  }
</style>
