<script lang="ts">
  import { overlayScrollbar } from '$lib/scrollbar';
  import { onMount } from 'svelte';
  import Search from '@lucide/svelte/icons/search';
  import * as Card from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import FileIcon from '$lib/components/file-tree/file-icon.svelte';
  import EmptyState from '$lib/components/empty-state/empty-state.svelte';
  import FileTree from '$lib/components/file-tree/file-tree.svelte';
  import FileViewer from '$lib/components/file-tree/file-viewer.svelte';
  import PaneHeader from '$lib/components/pane-header/pane-header.svelte';
  import { watchFiles } from '$lib/file-watch';
  import { toolPaneIcon, type PaneProps } from '$lib/panes';
  import { cn } from '$lib/utils';
  import { errorMessage } from '$shared/domain';
  import type { Entry } from '$shared/contracts';

  const SEARCH_DEBOUNCE_MS = 120;

  let {
    projectId,
    title,
    dragHandle,
    size,
    onresize,
    onclose,
    onrename,
  }: PaneProps & { projectId: string; title: string } = $props();

  /** Loaded directory listings by path; the project root is `''`. */
  let entries = $state<Record<string, Entry[]>>({});
  let expanded = $state<Record<string, boolean>>({});
  /** The file shown over the tree, if any. */
  let openFile = $state('');
  let error = $state('');
  let generation = 0;
  let query = $state('');
  /** Paths matching `query`; `undefined` until the first search for it returns. */
  let results = $state<string[]>();

  async function refresh() {
    const token = ++generation;
    const directories = [
      '',
      ...Object.keys(expanded).filter((path) => expanded[path]),
    ];
    const listings = await Promise.all(
      // A folder deleted while open fails to list; it just drops out of the tree.
      directories.map((path) =>
        window.bonfire.filesystem.list(projectId, path).catch(() => null),
      ),
    );
    if (token !== generation) return;
    entries = Object.fromEntries(
      directories.flatMap((path, index) =>
        listings[index] ? [[path, listings[index]]] : [],
      ),
    );
  }

  function toggleDirectory(path: string) {
    expanded[path] = !expanded[path];
    if (expanded[path]) void refresh();
  }

  // Searching waits for a pause in typing; a slower reply never overwrites a newer one.
  $effect(() => {
    const text = query.trim();
    if (!text) {
      results = undefined;
      return;
    }
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const found = await window.bonfire.filesystem.search(projectId, text);
        if (!stale) results = found;
      } catch (cause) {
        if (!stale) error = errorMessage(cause);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  });

  onMount(() => {
    void refresh();
    const stop = watchFiles(projectId, refresh, {
      onerror: (cause) => (error = errorMessage(cause)),
    });
    return () => {
      generation++;
      stop();
    };
  });
</script>

<Card.Root class="relative h-full min-w-0">
  <PaneHeader
    {title}
    icon={toolPaneIcon('files')}
    {dragHandle}
    {size}
    {onresize}
    {onclose}
    {onrename}
  />
  <section
    {@attach overlayScrollbar}
    class="min-h-0 flex-1 overflow-auto px-3 pb-2"
  >
    <div class="sticky top-0 z-10 -mx-3 bg-card px-3 pt-0.5 pb-4">
      <div class="relative">
        <Search
          class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          placeholder="Search files"
          aria-label="Search files"
          autocomplete="off"
          spellcheck="false"
          class="rounded-lg border-transparent bg-composer pl-8 focus-visible:border-transparent dark:bg-composer [&::-webkit-search-cancel-button]:appearance-none"
          bind:value={query}
          onkeydown={(event) => {
            if (event.key === 'Escape') query = '';
          }}
        />
      </div>
    </div>
    {#if error}<p class="text-sm text-destructive">{error}</p>{/if}

    {#if query.trim()}
      {#each results ?? [] as path (path)}
        {@const slash = path.lastIndexOf('/') + 1}
        <button
          type="button"
          class={cn(
            'flex h-7 w-full items-center gap-2.5 rounded-lg px-2 text-left font-mono text-sm transition-colors duration-150 outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/60',
            openFile === path && 'bg-secondary',
          )}
          onclick={() => (openFile = path)}
        >
          <FileIcon name={path.slice(slash)} class="shrink-0" />
          <span class="min-w-0 flex-1 truncate">
            {path.slice(slash)}
            <span class="text-muted-foreground">{path.slice(0, slash)}</span>
          </span>
        </button>
      {:else}
        {#if results}
          <EmptyState
            icon={toolPaneIcon('files')}
            title="No files found"
            description={`Nothing matches “${query.trim()}”.`}
            class="py-8"
          />
        {/if}
      {/each}
    {:else}
      <FileTree
        {entries}
        {expanded}
        selected={openFile}
        ontoggle={toggleDirectory}
        onopen={(path) => (openFile = path)}
      />
    {/if}
  </section>
  {#if openFile}
    <FileViewer
      {projectId}
      path={openFile}
      onclose={() => (openFile = '')}
      {size}
      {onresize}
      onclosepanel={onclose}
    />
  {/if}
</Card.Root>
