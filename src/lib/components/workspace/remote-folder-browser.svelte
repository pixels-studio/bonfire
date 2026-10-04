<script lang="ts">
  import { overlayScrollbar } from '$lib/scrollbar';
  import { onMount } from 'svelte';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import Icon from '$lib/components/icon/icon.svelte';
  import type { RemoteFolder } from '$shared/contracts';
  import { errorMessage } from '$shared/domain';

  let {
    connectionId,
    onselect,
    oncancel,
  }: {
    connectionId: string;
    onselect: (path: string) => void;
    oncancel: () => void;
  } = $props();

  let folder = $state<RemoteFolder>();
  /** The path as typed; it follows the folder shown until the user edits it. */
  let typed = $state('');
  let loading = $state(true);
  let error = $state<string>();
  /** Answers to older requests are dropped, so fast clicking can't show a stale folder. */
  let request = 0;

  async function open(path?: string) {
    const current = ++request;
    loading = true;
    error = undefined;
    try {
      const next = await window.bonfire.connections.browse(connectionId, path);
      if (current !== request) return;
      folder = next;
      typed = next.path;
    } catch (cause) {
      if (current === request) error = errorMessage(cause);
    } finally {
      if (current === request) loading = false;
    }
  }

  function child(name: string) {
    if (!folder) return name;
    return `${folder.path.replace(/\/$/, '')}/${name}`;
  }

  onMount(() => void open());
</script>

<div class="flex flex-col">
  <form
    class="flex items-center gap-2 border-b border-border p-2"
    onsubmit={(event) => {
      event.preventDefault();
      void open(typed.trim() || undefined);
    }}
  >
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      class="shrink-0 text-muted-foreground"
      aria-label="Parent folder"
      disabled={!folder?.parent || loading}
      onclick={() => open(folder?.parent)}
    >
      <ArrowUp class="size-4" />
    </Button>
    <Input
      bind:value={typed}
      class="h-7 font-mono text-xs"
      aria-label="Folder path"
      spellcheck={false}
      autocapitalize="off"
    />
  </form>
  <div {@attach overlayScrollbar} class="h-52 overflow-y-auto p-1" aria-busy={loading}>
    {#if error}
      <p class="p-3 text-xs text-pretty text-destructive" role="alert">
        {error}
      </p>
    {:else if folder && !folder.folders.length && !loading}
      <p class="p-3 text-xs text-muted-foreground">No folders here</p>
    {:else if folder}
      <ul class={loading ? 'opacity-50 transition-opacity' : undefined}>
        {#each folder.folders as name (name)}
          <li>
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
              onclick={() => open(child(name))}
            >
              <Icon
                name="folder"
                class="size-4 shrink-0 text-muted-foreground"
              />
              <span class="truncate">{name}</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="p-3 text-xs shimmer-text" role="status">Connecting</p>
    {/if}
  </div>
  <div
    class="flex items-center justify-between gap-2 border-t border-border p-2"
  >
    <span class="truncate pl-1 font-mono text-xs text-muted-foreground">
      {folder?.path ?? ''}
    </span>
    <div class="flex shrink-0 gap-1.5">
      <Button type="button" variant="ghost" size="sm" onclick={oncancel}>
        Cancel
      </Button>
      <Button
        type="button"
        size="sm"
        disabled={!folder || loading || !!error}
        onclick={() => folder && onselect(folder.path)}
      >
        Use this folder
      </Button>
    </div>
  </div>
</div>
