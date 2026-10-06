<script lang="ts">
  import { buttonVariants } from '$lib/components/ui/button';
  import { shortcutText } from '$lib/shortcuts';
  import { cn, isMac } from '$lib/utils';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import Icon from '$lib/components/icon/icon.svelte';
  import { connections } from '$lib/stores/connections.svelte';
  import type { Project } from '$shared/contracts';
  import { projectLocation } from '$shared/domain';
  import {
    ATTENTION_DOTS,
    ATTENTION_LABELS,
    ATTENTION_RANK,
    type ProjectAttention,
  } from '$lib/pane-status.svelte';

  let {
    projects,
    active,
    attention = {},
    side = 'bottom',
    open = $bindable(false),
    onselect,
    onadd,
    onremove,
    class: className,
  }: {
    projects: Project[];
    active?: Project;
    /** The most urgent thing each other project has for the user; the open one never shows. */
    attention?: Record<string, ProjectAttention>;
    side?: 'top' | 'bottom';
    open?: boolean;
    onselect: (id: string) => void;
    onadd: () => void;
    /** Shows per-project actions when given; without it the picker only picks. */
    onremove?: (id: string) => void;
    /** Classes for the trigger, such as to fill a column. */
    class?: string;
  } = $props();

  /** Stable pseudo-random hue per project so each folder keeps its color. */
  function folderColor(id: string) {
    let hash = 0;
    for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return `color: oklch(0.72 0.15 ${hash % 360})`;
  }

  /** The trigger repeats the most urgent of the others, so the signal shows with the menu closed. */
  const triggerAttention = $derived(
    Object.entries(attention)
      .filter(([id]) => id !== active?.id)
      .map(([, status]) => status)
      .sort((a, b) => ATTENTION_RANK[b] - ATTENTION_RANK[a])[0],
  );

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
  {#if src}
    <span
      class="grid size-4 shrink-0 place-items-center overflow-hidden rounded"
      aria-hidden="true"
    >
      <img class="size-full object-cover" {src} alt="" />
    </span>
  {:else}
    <Icon
      name={project?.connectionId ? 'folder-remote' : 'folder'}
      class="shrink-0 text-muted-foreground"
      style={project && folderColor(project.id)}
    />
  {/if}
{/snippet}

{#snippet attentionDot(status: ProjectAttention, class_?: string)}
  <span
    class={cn('size-2 shrink-0 rounded-full', ATTENTION_DOTS[status], class_)}
    role="img"
    aria-label={ATTENTION_LABELS[status]}
    title={ATTENTION_LABELS[status]}
  ></span>
{/snippet}

<DropdownMenu.Root bind:open>
  <DropdownMenu.Trigger
    class={cn(
      buttonVariants({ variant: 'secondary' }),
      'h-7.5 max-w-56 min-w-0 gap-2 py-0 pr-2.5 pl-2',
      className,
    )}
    title={`Switch project (${shortcutText('switchProject', isMac())})`}
  >
    {@render favicon(active)}
    <span class="flex-1 truncate text-left"
      >{active?.name || 'Select project'}</span
    >
    {#if triggerAttention}
      {@render attentionDot(triggerAttention)}
    {/if}
    <ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="start" {side} class="w-60">
    {#each projects as project (project.id)}
      <DropdownMenu.Item class="gap-2" onclick={() => onselect(project.id)}>
        {@render favicon(project)}
        <span class="min-w-0 flex-1 truncate">{project.name}</span>
        <div class="flex min-w-0 shrink-0 items-center gap-3">
          {#if project.connectionId}
            <span
              class="flex max-w-24 min-w-0 shrink items-center gap-1 text-xs text-muted-foreground"
              title={`On ${projectLocation(project, connections.all)}`}
            >
              <Icon name="server" class="size-3 shrink-0" />
              <span class="truncate">
                {projectLocation(project, connections.all)}
              </span>
            </span>
          {/if}
          {#if project.id !== active?.id && attention[project.id]}
            {@render attentionDot(attention[project.id])}
          {/if}
          {#if onremove}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                {#snippet child({ props })}
                  <button
                    {...props}
                    type="button"
                    class="-my-0.5 -mr-0.5 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground"
                    aria-label={`Actions for ${project.name}`}
                    onclick={(event) => event.stopPropagation()}
                  >
                    <Icon name="dots" class="size-4" />
                  </button>
                {/snippet}
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Item
                  variant="destructive"
                  onclick={() => {
                    open = false;
                    onremove(project.id);
                  }}
                >
                  <Icon name="trash" /> Remove
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          {/if}
        </div>
      </DropdownMenu.Item>
    {/each}
    <DropdownMenu.Separator />
    <DropdownMenu.Item class="gap-2" onclick={onadd}>
      <Icon name="plus" class="size-4" /> Project
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
