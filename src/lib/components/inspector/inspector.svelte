<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import { Button } from '$lib/components/ui/button';
  import { errorMessage } from '$shared/domain';
  import type { Entry, GitStatus, Session } from '$shared/contracts';

  type InspectorMode = 'diff' | 'files';

  const REFRESH_DEBOUNCE_MS = 180;
  const POLL_INTERVAL_MS = 5000;
  const FILE_ROW = 'flex w-full items-center gap-3 py-3.5 text-left text-sm';
  const CODE_BLOCK =
    'mb-3 overflow-auto rounded-lg border border-border p-3 font-mono text-xs/relaxed whitespace-pre';

  let {
    session,
    initialMode = 'diff',
  }: { session: Session; initialMode?: InspectorMode } = $props();

  let mode = $state(untrack(() => initialMode));
  let status = $state<GitStatus>({ isGit: false, branch: '', changes: [] });
  let entries = $state<Entry[]>([]);
  let directory = $state('');
  let selectedPath = $state('');
  let content = $state('');
  let error = $state('');
  let generation = 0;

  const parentDirectory = $derived(directory.split('/').slice(0, -1).join('/'));

  function joinPath(...segments: string[]) {
    return segments.filter(Boolean).join('/');
  }

  function diffLineClass(line: string) {
    if (line.startsWith('@@')) return 'text-indigo-300';
    if (line.startsWith('+')) return 'bg-green-950 text-green-300';
    if (line.startsWith('-')) return 'bg-red-950 text-red-300';
    return '';
  }

  async function refresh() {
    const token = ++generation;
    try {
      const [nextStatus, nextEntries] = await Promise.all([
        window.bonfire.git.status(session.id),
        window.bonfire.filesystem.list(session.id, directory),
      ]);
      if (token !== generation) return;
      status = nextStatus;
      entries = nextEntries;
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

  function openDirectory(path: string) {
    directory = path;
    selectedPath = '';
    content = '';
    void refresh();
  }

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

<section class="h-full overflow-auto px-4 py-2.5">
  {#if error}<p class="text-sm text-destructive">{error}</p>{/if}

  {#if mode === 'diff'}
    {#each status.changes as change (change.path)}
      <button class={FILE_ROW} onclick={() => preview(change.path)}>
        <span class="text-xl text-brand">±</span>
        <span class="truncate">{change.path}</span>
        <span class="ml-auto font-mono text-success"
          >{change.index}{change.worktree}</span
        >
      </button>
      {#if selectedPath === change.path}
        <div class={CODE_BLOCK}>
          {#each content.split('\n') as line}
            <div class={diffLineClass(line)}>{line || ' '}</div>
          {/each}
        </div>
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
          onclick={() => (mode = 'files')}
        >
          Browse files
        </Button>
      </div>
    {/each}
  {:else}
    <div class="mb-3 flex items-center gap-2">
      <Button
        variant="secondary"
        size="icon"
        aria-label="Parent folder"
        disabled={!directory}
        onclick={() => openDirectory(parentDirectory)}
      >
        <ArrowUp />
      </Button>
      <span class="truncate text-sm text-muted-foreground">/{directory}</span>
    </div>
    {#each entries as entry (entry.name)}
      {@const path = joinPath(directory, entry.name)}
      <button
        class={FILE_ROW}
        onclick={() => (entry.directory ? openDirectory(path) : preview(path))}
      >
        <span class="text-muted-foreground">{entry.directory ? '▸' : '·'}</span>
        {entry.name}
      </button>
    {/each}
    {#if selectedPath}
      <p class="mt-5 mb-2 text-sm text-muted-foreground">{selectedPath}</p>
      <pre class={CODE_BLOCK}>{content}</pre>
    {/if}
  {/if}
</section>
