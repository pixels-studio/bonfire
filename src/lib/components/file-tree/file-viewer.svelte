<script lang="ts">
  import { overlayScrollbar } from '$lib/scrollbar';
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { Button } from '$lib/components/ui/button';
  import Icon from '$lib/components/icon/icon.svelte';
  import PaneMenu from '$lib/components/pane-menu/pane-menu.svelte';
  import type { PaneSize } from '$lib/panes';
  import { watchFiles } from '$lib/file-watch';
  import { highlight, type Token } from '$lib/highlight';
  import { errorMessage } from '$shared/domain';
  import FileIcon from './file-icon.svelte';

  let {
    workspaceId,
    path,
    onclose,
    size,
    onresize,
    onclosepanel,
  }: {
    workspaceId: string;
    path: string;
    /** Closes the file, back to the tree. */
    onclose: () => void;
    /** The panel's current size, left out of the pane menu's list of sizes to switch to. */
    size: PaneSize;
    onresize: (size: PaneSize) => void;
    /** Closes the whole panel. */
    onclosepanel: () => void;
  } = $props();

  const slash = $derived(path.lastIndexOf('/') + 1);
  const name = $derived(path.slice(slash));

  let content = $state<string>();
  let error = $state('');
  const lines = $derived(content === undefined ? [] : content.split('\n'));
  const source = $derived(lines.join('\n'));

  let highlighted = $state<{ source: string; tokens: Token[][] }>({
    source: '',
    tokens: [],
  });
  // Tokens from an earlier version of the file are never shown against newer lines.
  const tokens = $derived(
    highlighted.source === source ? highlighted.tokens : [],
  );

  async function load() {
    try {
      const next = await window.bonfire.filesystem.readFile(workspaceId, path);
      if (next !== content) content = next;
      error = '';
    } catch (cause) {
      content = undefined;
      error = errorMessage(cause);
    }
  }

  $effect(() => {
    const current = lines;
    const key = source;
    let stale = false;
    highlight(current, path)
      .then((result) => {
        if (!stale) highlighted = { source: key, tokens: result };
      })
      .catch(() => {});
    return () => (stale = true);
  });

  onMount(() => {
    void load();
    return watchFiles(workspaceId, load, { poll: false });
  });

  function lineTokens(index: number): Token[] {
    return tokens[index] ?? (lines[index] ? [{ content: lines[index] }] : []);
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape') onclose();
  }}
/>

<div
  transition:fly|global={{ y: 24, duration: 160 }}
  class="absolute inset-0 z-20 flex min-w-0 flex-col bg-card"
>
  <header
    class="flex min-h-13.5 shrink-0 items-center justify-between gap-3 py-3 pr-2 pl-4"
  >
    <h2
      class="flex min-w-0 items-center gap-2 text-sm font-semibold"
      title={path}
    >
      <FileIcon {name} class="shrink-0" />
      <span class="truncate">{name}</span>
    </h2>
    <div class="flex shrink-0 items-center gap-2">
      <Button
        variant="secondary"
        size="icon"
        class="shrink-0 rounded-full"
        aria-label="Close file"
        onclick={onclose}
      >
        <ChevronDown />
      </Button>
      <PaneMenu label="Files options" {size} {onresize} />
      <Button
        variant="secondary"
        size="icon"
        class="shrink-0 text-muted-foreground hover:text-foreground"
        aria-label="Close Files"
        onclick={onclosepanel}
      >
        <Icon name="close" />
      </Button>
    </div>
  </header>
  <div
    {@attach overlayScrollbar}
    class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-3"
  >
    {#if error}
      <p class="px-4 text-sm text-muted-foreground">{error}</p>
    {:else if content !== undefined}
      <div class="py-1 font-mono text-xs/relaxed">
        {#each lines as _line, index (index)}
          <div class="flex">
            <span
              class="w-12 shrink-0 pr-3 text-right text-muted-foreground/60 select-none"
              >{index + 1}</span
            >
            <span class="min-w-0 flex-1 pr-4 break-words whitespace-pre-wrap"
              >{#each lineTokens(index) as token}<span style:color={token.color}
                  >{token.content}</span
                >{:else}{' '}{/each}</span
            >
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
