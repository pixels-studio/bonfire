<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import Icon from '$lib/components/icon/icon.svelte';
  import { errorMessage } from '$shared/domain';
  import type { Session } from '$shared/contracts';

  let { session, onswitch }: { session: Session; onswitch: () => void } =
    $props();

  let branches = $state<string[]>([]);
  let loading = $state(false);
  let error = $state('');

  async function loadBranches() {
    loading = true;
    error = '';
    try {
      branches = await window.bonfire.git.branches(session.projectId);
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      loading = false;
    }
  }

  async function checkout(branch: string) {
    if (branch === session.branch) return;
    error = '';
    try {
      await window.bonfire.git.checkout(session.id, branch);
      onswitch();
    } catch (cause) {
      error = errorMessage(cause);
    }
  }
</script>

<DropdownMenu.Root onOpenChange={(open) => open && loadBranches()}>
  <DropdownMenu.Trigger
    class="flex items-center gap-2 text-sm text-muted-foreground"
  >
    <Icon name="git" class="size-4" />
    {session.branch || 'Folder'}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="start" side="top" class="w-64">
    <DropdownMenu.Label>Switch branch</DropdownMenu.Label>
    {#if loading}
      <DropdownMenu.Item disabled>Loading branches…</DropdownMenu.Item>
    {:else if error}
      <DropdownMenu.Item disabled>{error}</DropdownMenu.Item>
    {:else}
      {#each branches as branch (branch)}
        <DropdownMenu.Item onclick={() => checkout(branch)}>
          {branch}
          {#if branch === session.branch}<Check class="ml-auto" />{/if}
        </DropdownMenu.Item>
      {:else}
        <DropdownMenu.Item disabled>No branches found</DropdownMenu.Item>
      {/each}
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
