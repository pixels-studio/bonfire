<script lang="ts">
  import { overlayScrollbar } from '$lib/scrollbar';
  import { onMount } from 'svelte';
  import GitCommitHorizontal from '@lucide/svelte/icons/git-commit-horizontal';
  import FolderX from '@lucide/svelte/icons/folder-x';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import Icon from '$lib/components/icon/icon.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import * as Card from '$lib/components/ui/card';
  import FileDiff from '$lib/components/diff/file-diff.svelte';
  import FileIcon from '$lib/components/file-tree/file-icon.svelte';
  import PaneHeader from '$lib/components/pane-header/pane-header.svelte';
  import { watchFiles } from '$lib/file-watch';
  import { toolPaneIcon, type PaneProps } from '$lib/panes';
  import { errorMessage } from '$shared/domain';
  import type { GitStatus } from '$shared/contracts';

  let {
    projectId,
    title,
    dragHandle,
    size,
    onresize,
    onclose,
    onrename,
  }: PaneProps & { projectId: string; title: string } = $props();

  let status = $state<GitStatus>();
  /** The changed file whose diff is expanded, if any. */
  let selectedPath = $state('');
  /** The expanded file's diff, once loaded. */
  let diff = $state<{ path: string; text: string }>();
  let error = $state('');
  let generation = 0;

  async function refresh() {
    const token = ++generation;
    try {
      const next = await window.bonfire.git.status(projectId);
      if (token !== generation) return;
      status = next;
      error = '';
      if (selectedPath) await loadDiff(selectedPath);
    } catch (cause) {
      if (token === generation) error = errorMessage(cause);
    }
  }

  async function loadDiff(path: string) {
    let text: string;
    try {
      text = await window.bonfire.git.diff(projectId, path);
    } catch (cause) {
      text = errorMessage(cause);
    }
    if (selectedPath === path) diff = { path, text };
  }

  /** What the confirm dialog is about to discard: one file, or every change. */
  let reverting = $state<{ path?: string }>();
  let confirmOpen = $state(false);
  let working = $state(false);

  function askRevert(path?: string) {
    reverting = { path };
    confirmOpen = true;
  }

  async function revert() {
    if (!reverting) return;
    const { path } = reverting;
    working = true;
    try {
      await window.bonfire.git.discard(projectId, path);
      if (!path || path === selectedPath) selectedPath = '';
      confirmOpen = false;
      await refresh();
    } catch (cause) {
      confirmOpen = false;
      toast(errorMessage(cause));
    } finally {
      working = false;
    }
  }

  function toggle(path: string) {
    selectedPath = selectedPath === path ? '' : path;
    if (selectedPath) void loadDiff(path);
  }

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
    icon={toolPaneIcon('diff')}
    {dragHandle}
    {size}
    {onresize}
    {onclose}
    {onrename}
  >
    {#snippet menuItems()}
      <DropdownMenu.Item
        disabled={!status?.changes.length}
        onclick={() => askRevert()}
      >
        <Icon name="revert" />
        Revert all changes
      </DropdownMenu.Item>
    {/snippet}
  </PaneHeader>
  <section
    {@attach overlayScrollbar}
    class="min-h-0 flex-1 overflow-auto px-4 pt-2 pb-2 [&:has(>div:only-child)]:flex [&:has(>div:only-child)]:flex-col"
  >
    {#if error}<p class="text-sm text-destructive">{error}</p>{/if}
    {#each status?.changes ?? [] as change (change.path)}
      {@const slash = change.path.lastIndexOf('/') + 1}
      <div class="group relative flex items-center">
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-3 rounded-md py-3 text-left font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          aria-expanded={selectedPath === change.path}
          onclick={() => toggle(change.path)}
        >
          <FileIcon name={change.path.slice(slash)} class="shrink-0" />
          <span class="min-w-0 flex-1 truncate">
            <span class="text-muted-foreground"
              >{change.path.slice(0, slash)}</span
            >{change.path.slice(slash)}
          </span>
          <span
            class="flex shrink-0 items-center gap-3 transition-opacity group-focus-within:opacity-0 group-hover:opacity-0"
          >
            {#if change.additions}
              <span class="text-success">+{change.additions}</span>
            {/if}
            {#if change.deletions}
              <span class="text-destructive">-{change.deletions}</span>
            {/if}
          </span>
        </button>
        <Button
          variant="secondary"
          size="icon"
          class="absolute top-1/2 right-0 size-7 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-foreground"
          aria-label={`Revert changes to ${change.path}`}
          title="Revert changes"
          onclick={() => askRevert(change.path)}
        >
          <Icon name="revert" />
        </Button>
      </div>
      {#if selectedPath === change.path && diff?.path === change.path}
        <FileDiff diff={diff.text} path={change.path} />
      {/if}
    {:else}
      {#if status}
        <div
          class="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground"
        >
          {#if status.isGit}
            <GitCommitHorizontal class="size-8 opacity-60" />
          {:else}
            <FolderX class="size-8 opacity-60" />
          {/if}
          <p class="text-sm">
            {status.isGit
              ? 'Your working tree is clean.'
              : 'This folder is not a Git repository.'}
          </p>
        </div>
      {/if}
    {/each}
  </section>
</Card.Root>

<Dialog.Root bind:open={confirmOpen}>
  <Dialog.Content class="w-[min(28rem,calc(100vw-2rem))] gap-0 p-0">
    <Dialog.Header>
      <Dialog.Title class="text-lg font-semibold">
        {reverting?.path ? 'Revert this file?' : 'Revert all changes?'}
      </Dialog.Title>
    </Dialog.Header>
    <Dialog.Body>
      <p class="text-sm text-pretty text-muted-foreground">
        {#if reverting?.path}
          This discards every uncommitted change to
          <span class="font-mono text-foreground">{reverting.path}</span>. It
          can't be undone.
        {:else}
          This discards every uncommitted change in the project, including new
          files. It can't be undone.
        {/if}
      </p>
    </Dialog.Body>
    <Dialog.Footer>
      <Button
        variant="secondary"
        class="min-w-20"
        onclick={() => (confirmOpen = false)}
      >
        Cancel
      </Button>
      <Button
        variant="destructive"
        class="min-w-20"
        disabled={working}
        onclick={revert}
      >
        Revert
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
