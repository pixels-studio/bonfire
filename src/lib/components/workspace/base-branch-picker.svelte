<script lang="ts">
  import { buttonVariants } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import * as Popover from '$lib/components/ui/popover';
  import { Input } from '$lib/components/ui/input';
  import { errorMessage } from '$shared/domain';

  let { projectId, value = $bindable() }: { projectId: string; value: string } =
    $props();

  let open = $state(false);
  let branches = $state<string[]>([]);
  let filter = $state('');
  let error = $state('');
  let loading = $state(false);

  const matching = $derived(
    branches.filter((branch) =>
      branch.toLowerCase().includes(filter.trim().toLowerCase()),
    ),
  );

  async function load() {
    loading = true;
    error = '';
    try {
      branches = await window.bonfire.git.branches(projectId);
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      loading = false;
    }
  }

  function choose(branch: string) {
    value = branch;
    open = false;
  }
</script>

<Popover.Root
  bind:open
  onOpenChange={(next) => {
    if (!next) return;
    filter = '';
    void load();
  }}
>
  <Popover.Trigger
    class={cn(
      buttonVariants({ variant: 'secondary' }),
      'h-7.5 min-w-0 gap-1.5 py-0 pr-2.5 pl-3',
    )}
  >
    <span class="shrink-0 text-muted-foreground">Start from</span>
    <span class="truncate">{value || '…'}</span>
    <ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
  </Popover.Trigger>
  <Popover.Content align="end" class="w-72 gap-1.5 p-1.5">
    <Input
      bind:value={filter}
      placeholder="Filter branches"
      aria-label="Filter branches"
      class="h-8"
      onkeydown={(event) => {
        if (event.key === 'Enter' && matching[0]) {
          event.preventDefault();
          choose(matching[0]);
        }
      }}
    />
    <div class="max-h-64 overflow-y-auto" role="listbox" aria-label="Branches">
      {#if loading && !branches.length}
        <p class="px-1.5 py-1.5 text-muted-foreground">Loading branches…</p>
      {:else if error}
        <p class="px-1.5 py-1.5 text-destructive">{error}</p>
      {:else}
        {#each matching as branch (branch)}
          <button
            type="button"
            role="option"
            aria-selected={branch === value}
            class="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left outline-none hover:bg-accent focus-visible:bg-accent"
            title={branch}
            onclick={() => choose(branch)}
          >
            <span class="truncate">{branch}</span>
            {#if branch === value}<Check class="ml-auto size-4 shrink-0" />{/if}
          </button>
        {:else}
          <p class="px-1.5 py-1.5 text-muted-foreground">No branches found</p>
        {/each}
      {/if}
    </div>
  </Popover.Content>
</Popover.Root>
