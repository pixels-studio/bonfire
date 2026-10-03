<script lang="ts">
  import { untrack } from 'svelte';
  import { buttonVariants } from '$lib/components/ui/button';
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import Icon from '$lib/components/icon/icon.svelte';
  import ShortcutKeys from '$lib/components/shortcuts/shortcut-keys.svelte';
  import { shortcutText } from '$lib/shortcuts';
  import { cn, formatAge, isMac } from '$lib/utils';
  import type { Branch, GitHead } from '$shared/contracts';
  import { errorMessage } from '$shared/domain';

  let {
    projectId,
    head,
    locked,
    open = $bindable(false),
    onswitch,
    onnew,
  }: {
    projectId: string;
    /** What the project has checked out; unknown until looked up. */
    head?: GitHead;
    /** Whether an agent is working, which rules out switching. */
    locked: boolean;
    open?: boolean;
    onswitch: (name: string) => void;
    onnew: () => void;
  } = $props();

  let branches = $state<Branch[]>([]);
  /** The project `branches` were listed for, so another project's never show. */
  let listedFor = $state<string>();
  let loading = $state(false);
  let error = $state('');

  /** The checked-out branch first, then the most recently committed. */
  const ordered = $derived(
    listedFor === projectId
      ? branches.toSorted(
          (first, second) =>
            Number(second.name === head?.branch) -
            Number(first.name === head?.branch),
        )
      : [],
  );
  const label = $derived(
    !head
      ? undefined
      : !head.isGit
        ? 'Not a repository'
        : (head.branch ?? 'Detached HEAD'),
  );

  // Lists the branches each time the menu opens.
  $effect(() => {
    if (open) untrack(() => void load());
  });

  async function load() {
    const id = projectId;
    loading = true;
    error = '';
    try {
      const listed = await window.bonfire.git.localBranches(id);
      if (id !== projectId) return;
      branches = listed;
      listedFor = id;
    } catch (cause) {
      if (id === projectId) error = errorMessage(cause);
    } finally {
      loading = false;
    }
  }
</script>

<DropdownMenu.Root bind:open>
  <DropdownMenu.Trigger
    class={cn(
      buttonVariants({ variant: 'secondary' }),
      'h-7.5 min-w-0 gap-2 py-0 pr-2.5 pl-2.5',
    )}
    disabled={head && !head.isGit}
    title={head && !head.isGit
      ? 'This folder isn’t a git repository'
      : `Switch branch (${shortcutText('switchBranch', isMac())})`}
  >
    <Icon name="branch" class="size-4 shrink-0 text-muted-foreground" />
    {#if label}
      <span class="max-w-64 truncate">{label}</span>
    {:else}
      <span
        class="h-3.5 w-16 animate-pulse rounded-sm bg-foreground/10 motion-reduce:animate-none"
        role="status"
        aria-label="Loading branch"
      ></span>
    {/if}
    <ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="start" class="max-h-[70vh] w-96">
    {#if locked}
      <p class="px-1.5 py-1.5 text-xs text-muted-foreground">
        An agent is working. Switch branches once it finishes.
      </p>
    {/if}
    {#if error}
      <p class="px-1.5 py-1.5 text-destructive">{error}</p>
    {:else if loading && !ordered.length}
      <div
        class="flex flex-col gap-3 px-1.5 py-1.5"
        role="status"
        aria-label="Loading branches"
      >
        {#each [0, 1, 2] as row (row)}
          <span class="flex items-center gap-2">
            <span
              class="size-4 shrink-0 animate-pulse rounded-sm bg-foreground/10 motion-reduce:animate-none"
            ></span>
            <span class="flex flex-1 flex-col gap-1.5">
              <span
                class="h-3.5 w-1/3 animate-pulse rounded-sm bg-foreground/10 motion-reduce:animate-none"
              ></span>
              <span
                class="h-3 w-2/3 animate-pulse rounded-sm bg-foreground/10 motion-reduce:animate-none"
              ></span>
            </span>
          </span>
        {/each}
      </div>
    {/if}
    {#each ordered as item (item.name)}
      {@const current = item.name === head?.branch}
      <DropdownMenu.Item
        class="gap-2"
        disabled={locked && !current}
        onclick={() => !current && onswitch(item.name)}
      >
        <Icon name="branch" class="size-4 shrink-0 text-muted-foreground" />
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="truncate">{item.name}</span>
          <span class="truncate text-xs text-muted-foreground">
            {[formatAge(item.committedAt), item.subject]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        {#if current}
          <Check class="size-4 shrink-0" aria-label="Checked out" />
        {/if}
      </DropdownMenu.Item>
    {/each}
    {#if ordered.length}
      <DropdownMenu.Separator />
    {/if}
    <DropdownMenu.Item class="gap-2" disabled={locked} onclick={onnew}>
      <Icon name="plus" class="size-4" /> Branch
      <ShortcutKeys id="newBranch" class="ml-auto" />
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
