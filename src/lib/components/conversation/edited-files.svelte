<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { Badge } from '$lib/components/ui/badge';
  import EditedFilesIcon from '$lib/components/icon/edited-files-icon.svelte';
  import FileIcon from '$lib/components/file-tree/file-icon.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { errorMessage } from '$shared/domain';
  import type { Change } from '$shared/contracts';

  let { projectId, paths }: { projectId: string; paths: string[] } = $props();

  /** Shown past this many files, behind "Show N more files". */
  const COLLAPSED_COUNT = 3;

  let changes = $state<Change[]>();
  let expanded = $state(false);
  let generation = 0;

  async function load() {
    const token = ++generation;
    try {
      const next = await window.bonfire.git.changesAmong(projectId, paths);
      if (token === generation) changes = next;
    } catch (cause) {
      if (token === generation)
        toast(errorMessage(cause), { variant: 'error' });
    }
  }

  $effect(() => {
    void paths;
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
  <div class="flex flex-col gap-3 rounded-xl border border-border p-4 text-sm">
    <div class="flex items-center gap-2.5">
      <EditedFilesIcon class="size-5 shrink-0 text-muted-foreground" />
      <div class="flex min-w-0 flex-1 items-center gap-2">
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
      </div>
    </div>
    <div class="flex flex-col">
      {#each shown as change (change.path)}
        {@const slash = change.path.lastIndexOf('/') + 1}
        <div class="flex items-center gap-2.5 py-1.5 font-mono text-sm">
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
        </div>
      {/each}
    </div>
    {#if changes.length > COLLAPSED_COUNT}
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
    {/if}
  </div>
{/if}
