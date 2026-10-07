<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { Badge } from '$lib/components/ui/badge';
  import EditedFilesIcon from '$lib/components/icon/edited-files-icon.svelte';
  import FileIcon from '$lib/components/file-tree/file-icon.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { errorMessage } from '$shared/domain';
  import type { Change } from '$shared/contracts';

  let {
    workspaceId,
    paths,
    changes: given,
    onviewChanges,
  }: {
    workspaceId?: string;
    /** Files to look up the changes of, when `changes` isn't given. */
    paths?: string[];
    /** Changes already known, such as a whole task's; looked up from `paths` without it. */
    changes?: Change[];
    onviewChanges: (path?: string) => void;
  } = $props();

  /** Shown past this many files, behind "Show N more files". */
  const COLLAPSED_COUNT = 3;

  let fetched = $state<Change[]>();
  const changes = $derived(given ?? fetched);
  let expanded = $state(false);
  let generation = 0;

  async function load() {
    if (given || !workspaceId || !paths) return;
    const token = ++generation;
    try {
      const next = await window.bonfire.git.changesAmong(workspaceId, paths);
      if (token === generation) fetched = next;
    } catch (cause) {
      if (token === generation)
        toast(errorMessage(cause), { variant: 'error' });
    }
  }

  $effect(() => {
    void paths;
    void given;
    void load();
  });

  const total = $derived.by(() => {
    const list = changes ?? [];
    return {
      additions: list.reduce((sum, change) => sum + change.additions, 0),
      deletions: list.reduce((sum, change) => sum + change.deletions, 0),
    };
  });
  const shown = $derived(
    expanded ? (changes ?? []) : (changes ?? []).slice(0, COLLAPSED_COUNT),
  );
  const hidden = $derived((changes?.length ?? 0) - shown.length);
</script>

{#if changes?.length}
  <div class="overflow-hidden rounded-xl border border-border text-sm">
    <div class="flex items-center gap-2.5 px-4 pt-4 pb-3">
      <button
        type="button"
        class="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        title="View code changes"
        onclick={() => onviewChanges()}
      >
        <EditedFilesIcon class="size-5 shrink-0 text-muted-foreground" />
        <span class="font-medium">
          {changes.length}
          {changes.length === 1 ? 'file' : 'files'}
        </span>
        {#if total.additions || total.deletions}
          <Badge class="tabular-nums">
            {#if total.additions}
              <span class="text-success">+{total.additions}</span>
            {/if}
            {#if total.deletions}
              <span class="text-destructive">-{total.deletions}</span>
            {/if}
          </Badge>
        {/if}
      </button>
    </div>
    <div class={['flex flex-col', changes.length <= COLLAPSED_COUNT && 'pb-4']}>
      {#each shown as change (change.path)}
        {@const slash = change.path.lastIndexOf('/') + 1}
        <button
          type="button"
          class="relative flex w-full cursor-pointer items-center gap-2.5 px-4 py-1.5 text-left font-mono text-sm outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
          title={`View changes to ${change.path}`}
          onclick={() => onviewChanges(change.path)}
        >
          <FileIcon name={change.path.slice(slash)} class="size-5 shrink-0" />
          <span class="min-w-0 flex-1 truncate">
            <span class="text-muted-foreground"
              >{change.path.slice(0, slash)}</span
            >{change.path.slice(slash)}
          </span>
          {#if change.additions}
            <span class="shrink-0 text-success">+{change.additions}</span>
          {/if}
          {#if change.deletions}
            <span class="shrink-0 text-destructive">-{change.deletions}</span>
          {/if}
        </button>
      {/each}
    </div>
    {#if changes.length > COLLAPSED_COUNT}
      <div class="px-4 pt-3 pb-4">
        <button
          type="button"
          class="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          onclick={() => (expanded = !expanded)}
        >
          {expanded ? 'Collapse files' : `Show ${hidden} more files`}
          <ChevronDown
            class={['size-3.5 transition-transform', expanded && 'rotate-180']}
          />
        </button>
      </div>
    {/if}
  </div>
{/if}
