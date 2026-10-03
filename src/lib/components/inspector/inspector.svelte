<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Search from '@lucide/svelte/icons/search';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import DiffView from '$lib/components/diff/diff-view.svelte';
  import FileIcon from '$lib/components/file-tree/file-icon.svelte';
  import FileTree from '$lib/components/file-tree/file-tree.svelte';
  import { cn } from '$lib/utils';
  import { errorMessage } from '$shared/domain';
  import type { Entry, GitStatus, Session } from '$shared/contracts';

  type InspectorMode = 'diff' | 'files';

  const REFRESH_DEBOUNCE_MS = 180;
  const SEARCH_DEBOUNCE_MS = 120;
  const POLL_INTERVAL_MS = 5000;
  const FILE_ROW =
    'flex w-full items-center gap-3 py-3 text-left font-mono text-sm outline-none';

  let {
    session,
    initialMode = 'diff',
    openFile = '',
    onopenfile,
  }: {
    session: Session;
    initialMode?: InspectorMode;
    /** The file currently shown over the pane, if any. */
    openFile?: string;
    onopenfile: (path: string) => void;
  } = $props();

  let mode = $state(untrack(() => initialMode));
  let status = $state<GitStatus>({ isGit: false, branch: '', changes: [] });
  /** Loaded directory listings by path; the workspace root is `''`. */
  let entries = $state<Record<string, Entry[]>>({});
  let expanded = $state<Record<string, boolean>>({});
  let selectedPath = $state('');
  let content = $state('');
  let error = $state('');
  let generation = 0;
  let query = $state('');
  /** Paths matching `query`; `undefined` until the first search for it returns. */
  let results = $state<string[]>();

  async function refresh() {
    const token = ++generation;
    try {
      const directories = [
        '',
        ...Object.keys(expanded).filter((path) => expanded[path]),
      ];
      const [nextStatus, ...listings] = await Promise.all([
        window.bonfire.git.status(session.id),
        // A folder deleted while open fails to list; it just drops out of the tree.
        ...directories.map((path) =>
          window.bonfire.filesystem.list(session.id, path).catch(() => null),
        ),
      ]);
      if (token !== generation) return;
      status = nextStatus;
      entries = Object.fromEntries(
        directories.flatMap((path, index) =>
          listings[index] ? [[path, listings[index]]] : [],
        ),
      );
      if (selectedPath) await preview(selectedPath);
      error = '';
    } catch (cause) {
      error = errorMessage(cause);
    }
  }

  async function preview(path: string) {
    selectedPath = path;
    try {
      content =
        mode === 'diff'
          ? await window.bonfire.git.diff(session.id, path)
          : await window.bonfire.filesystem.readFile(session.id, path);
    } catch (cause) {
      content = errorMessage(cause);
    }
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
        const found = await window.bonfire.filesystem.search(session.id, text);
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
    window.bonfire.filesystem
      .watch(session.id)
      .catch((cause) => (error = errorMessage(cause)));

    let debounce: ReturnType<typeof setTimeout>;
    const unsubscribe = window.bonfire.filesystem.onChange((event) => {
      if (event.sessionId !== session.id) return;
      clearTimeout(debounce);
      debounce = setTimeout(refresh, REFRESH_DEBOUNCE_MS);
    });
    const poll = setInterval(refresh, POLL_INTERVAL_MS);

    return () => {
      generation++;
      unsubscribe();
      clearTimeout(debounce);
      clearInterval(poll);
      void window.bonfire.filesystem.unwatch(session.id);
    };
  });
</script>

<section class="h-full overflow-auto px-3 pb-2">
  {#if mode === 'files'}
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
          class="rounded-full pl-8 [&::-webkit-search-cancel-button]:appearance-none"
          bind:value={query}
          onkeydown={(event) => {
            if (event.key === 'Escape') query = '';
          }}
        />
      </div>
    </div>
  {:else}
    <div class="h-2"></div>
  {/if}
  {#if error}<p class="text-sm text-destructive">{error}</p>{/if}

  {#if mode === 'diff'}
    <!-- 12px section padding plus 4px lines content up with the header's 16px. -->
    <div class="px-1">
      {#each status.changes as change (change.path)}
        {@const slash = change.path.lastIndexOf('/') + 1}
        <button
          class={FILE_ROW}
          aria-expanded={selectedPath === change.path}
          onclick={() =>
            selectedPath === change.path
              ? (selectedPath = '')
              : preview(change.path)}
        >
          <FileIcon name={change.path.slice(slash)} class="shrink-0" />
          <span class="min-w-0 flex-1 truncate">
            <span class="text-muted-foreground"
              >{change.path.slice(0, slash)}</span
            >{change.path.slice(slash)}
          </span>
          {#if change.additions}
            <span class="shrink-0 font-mono text-success"
              >+{change.additions}</span
            >
          {/if}
          {#if change.deletions}
            <span class="shrink-0 font-mono text-destructive"
              >-{change.deletions}</span
            >
          {/if}
        </button>
        {#if selectedPath === change.path}
          <DiffView diff={content} path={change.path} />
        {/if}
      {:else}
        <div class="py-8 text-sm text-muted-foreground">
          <p>
            {status.isGit
              ? 'Your working tree is clean.'
              : 'This folder is not a Git repository.'}
          </p>
          <Button
            variant="secondary"
            class="mt-4"
            onclick={() => {
              selectedPath = '';
              mode = 'files';
            }}
          >
            Browse files
          </Button>
        </div>
      {/each}
    </div>
  {:else}
    {#if query.trim()}
      {#each results ?? [] as path (path)}
        {@const slash = path.lastIndexOf('/') + 1}
        <button
          type="button"
          class={cn(
            'flex h-7 w-full items-center gap-2.5 rounded-lg px-2 text-left font-mono text-sm transition-colors duration-150 outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/60',
            openFile === path && 'bg-secondary',
          )}
          onclick={() => onopenfile(path)}
        >
          <FileIcon name={path.slice(slash)} class="shrink-0" />
          <span class="min-w-0 flex-1 truncate">
            {path.slice(slash)}
            <span class="text-muted-foreground">{path.slice(0, slash)}</span>
          </span>
        </button>
      {:else}
        {#if results}
          <p class="px-2 py-4 text-sm text-muted-foreground">
            No files match “{query.trim()}”.
          </p>
        {/if}
      {/each}
    {:else}
      <FileTree
        {entries}
        {expanded}
        selected={openFile}
        ontoggle={toggleDirectory}
        onopen={onopenfile}
      />
    {/if}
  {/if}
</section>
