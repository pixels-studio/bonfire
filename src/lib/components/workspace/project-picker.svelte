<script lang="ts">
  import { buttonVariants } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import Icon from '$lib/components/icon/icon.svelte';
  import type { Project } from '$shared/contracts';

  let {
    projects,
    active,
    side = 'bottom',
    onselect,
    onadd,
    onsettings,
    onremove,
  }: {
    projects: Project[];
    active?: Project;
    side?: 'top' | 'bottom';
    onselect: (id: string) => void;
    onadd: () => void;
    /** Shows per-project actions when given; without it the picker only picks. */
    onsettings?: (id: string) => void;
    onremove?: (id: string) => void;
  } = $props();

  let menuOpen = $state(false);
  let favicons = $state<Record<string, string | null>>({});
  const requestedFavicons = new Set<string>();

  $effect(() => {
    for (const { id } of projects) {
      if (requestedFavicons.has(id)) continue;
      requestedFavicons.add(id);
      window.bonfire.projects
        .favicon(id)
        .then((icon) => (favicons[id] = icon))
        .catch(() => (favicons[id] = null));
    }
  });
</script>

{#snippet favicon(project?: Project)}
  {@const src = project && favicons[project.id]}
  <span
    class="grid size-4 shrink-0 place-items-center overflow-hidden rounded bg-brand text-white"
    aria-hidden="true"
  >
    {#if src}
      <img class="size-full object-cover" {src} alt="" />
    {:else}
      <Icon name="project" class="size-3" />
    {/if}
  </span>
{/snippet}

<DropdownMenu.Root bind:open={menuOpen}>
  <DropdownMenu.Trigger
    class={cn(
      buttonVariants({ variant: 'secondary' }),
      'h-7.5 max-w-56 min-w-0 gap-2 py-0 pr-2.5 pl-2',
    )}
  >
    {@render favicon(active)}
    <span class="truncate">{active?.name || 'Select project'}</span>
    <ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="start" {side} class="w-60">
    <DropdownMenu.Label>Projects</DropdownMenu.Label>
    {#each projects as project (project.id)}
      <DropdownMenu.Item class="gap-2" onclick={() => onselect(project.id)}>
        {@render favicon(project)}
        <span class="truncate">{project.name}</span>
        {#if project.id === active?.id}<Check class="size-4 shrink-0" />{/if}
        {#if onsettings || onremove}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <button
                  {...props}
                  type="button"
                  class="-my-0.5 -mr-0.5 ml-auto grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 group-hover/dropdown-menu-item:opacity-100 group-data-highlighted/dropdown-menu-item:opacity-100 hover:bg-muted hover:text-foreground aria-expanded:opacity-100"
                  aria-label={`Actions for ${project.name}`}
                  onclick={(event) => event.stopPropagation()}
                >
                  <Icon name="dots" class="size-4" />
                </button>
              {/snippet}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
              {#if onsettings}
                <DropdownMenu.Item
                  onclick={() => {
                    menuOpen = false;
                    onsettings(project.id);
                  }}
                >
                  <Icon name="settings" /> Project settings
                </DropdownMenu.Item>
              {/if}
              {#if onremove}
                <DropdownMenu.Item
                  variant="destructive"
                  onclick={() => onremove(project.id)}
                >
                  Remove project
                </DropdownMenu.Item>
              {/if}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        {/if}
      </DropdownMenu.Item>
    {/each}
    <DropdownMenu.Separator />
    <DropdownMenu.Item class="gap-2" onclick={onadd}>
      <Icon name="plus" class="size-4" /> Project
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
