<script lang="ts">
  import Folder from '@lucide/svelte/icons/folder';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { cn } from '$lib/utils';
  import type { Entry } from '$shared/contracts';
  import FileIcon from './file-icon.svelte';

  const INDENT_PX = 20;

  let {
    entries,
    expanded,
    selected = '',
    ontoggle,
    onopen,
  }: {
    /** Loaded directory listings keyed by path; the root is `''`. */
    entries: Record<string, Entry[]>;
    expanded: Record<string, boolean>;
    selected?: string;
    ontoggle: (path: string) => void;
    onopen: (path: string) => void;
  } = $props();

  function joinPath(directory: string, name: string) {
    return directory ? `${directory}/${name}` : name;
  }
</script>

<div role="tree" class="font-mono text-sm">
  {@render level('', 0)}
</div>

{#snippet level(directory: string, depth: number)}
  {#each entries[directory] ?? [] as entry (entry.name)}
    {@const path = joinPath(directory, entry.name)}
    {@const open = entry.directory && expanded[path]}
    <button
      type="button"
      role="treeitem"
      aria-expanded={entry.directory ? !!open : undefined}
      aria-selected={selected === path}
      class={cn(
        'group flex h-7 w-full items-center gap-2.5 rounded-lg pr-2 text-left transition-colors duration-150 outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/60',
        selected === path && 'bg-secondary',
      )}
      style:padding-left={`${8 + depth * INDENT_PX}px`}
      onclick={() => (entry.directory ? ontoggle(path) : onopen(path))}
    >
      {#if entry.directory}
        {#if open}
          <FolderOpen class="size-4 shrink-0 text-muted-foreground" />
        {:else}
          <Folder class="size-4 shrink-0 text-muted-foreground" />
        {/if}
      {:else}
        <FileIcon name={entry.name} class="shrink-0" />
      {/if}
      <span class="min-w-0 flex-1 truncate">{entry.name}</span>
      {#if entry.directory}
        <ChevronDown
          class={cn(
            'size-4 shrink-0 text-muted-foreground opacity-0 transition-[opacity,transform] duration-150 group-hover:opacity-100 group-focus-visible:opacity-100',
            open && 'rotate-180',
          )}
        />
      {/if}
    </button>
    {#if open}
      {@render level(path, depth + 1)}
    {/if}
  {/each}
{/snippet}
