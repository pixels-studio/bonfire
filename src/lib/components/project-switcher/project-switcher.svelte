<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { Button } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import Icon from '$lib/components/icon/icon.svelte';
  import type { Project } from '$shared/contracts';

  let {
    projects,
    active,
    onselect,
    onadd,
  }: {
    projects: Project[];
    active?: Project;
    onselect: (id: string) => void;
    onadd: () => void;
  } = $props();

  let favicons = $state<Record<string, string | null>>({});
  const requested = new Set<string>();

  $effect(() => {
    for (const project of projects) {
      if (requested.has(project.id)) continue;
      requested.add(project.id);
      void window.bonfire.projects
        .favicon(project.id)
        .then((icon) => (favicons[project.id] = icon))
        .catch(() => (favicons[project.id] = null));
    }
  });
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="secondary" class="project-trigger">
        <span class="favicon" aria-hidden="true">
          {#if active && favicons[active.id]}
            <img src={favicons[active.id]} alt="" />
          {:else}
            <Icon name="project" />
          {/if}
        </span>
        <span class="project-name">{active?.name || 'Select project'}</span>
        <ChevronDown class="chevron" />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="start" class="project-menu">
    <DropdownMenu.Label>Projects</DropdownMenu.Label>
    {#each projects as project}
      <DropdownMenu.Item onclick={() => onselect(project.id)}>
        <span class="menu-favicon">
          {#if favicons[project.id]}
            <img src={favicons[project.id]} alt="" />
          {:else}
            <Icon name="project" />
          {/if}
        </span>
        <span class="menu-label">{project.name}</span>
        {#if project.id === active?.id}<Check class="check" />{/if}
      </DropdownMenu.Item>
    {/each}
    <DropdownMenu.Separator />
    <DropdownMenu.Item onclick={onadd}><Icon name="plus" /> Add project</DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>

<style>
  :global(.project-trigger) {
    max-width: 240px;
    gap: 8px;
    padding-left: 8px;
    background: var(--control);
    color: var(--foreground);
  }
  .favicon,
  .menu-favicon {
    display: grid;
    flex: none;
    place-items: center;
    overflow: hidden;
    width: 20px;
    height: 20px;
    border-radius: 5px;
    background: var(--accent);
    color: white;
    font-size: 11px;
    font-weight: 600;
  }
  .favicon img,
  .menu-favicon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .favicon :global(svg),
  .menu-favicon :global(svg) {
    width: 14px;
    height: 14px;
  }
  .project-name,
  .menu-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.chevron) {
    width: 14px;
    height: 14px;
    color: var(--foreground-subtle);
  }
  :global(.project-menu) {
    width: 224px;
  }
  :global(.check) {
    margin-left: auto;
  }
</style>
