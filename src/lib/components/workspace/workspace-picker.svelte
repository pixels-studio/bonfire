<script lang="ts">
  import { buttonVariants } from '$lib/components/ui/button';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import Icon from '$lib/components/icon/icon.svelte';
  import type { PaneStatus } from '$lib/pane-status.svelte';
  import { cn, isMac } from '$lib/utils';
  import type { Session, SetupStatus } from '$shared/contracts';
  import { isWorktree, workspaceLabel } from '$shared/domain';

  const STATUS_DOTS: Record<Exclude<PaneStatus, 'idle'>, string> = {
    working: 'bg-brand animate-pulse motion-reduce:animate-none',
    input: 'bg-warning',
    error: 'bg-destructive',
  };
  const STATUS_LABELS: Record<Exclude<PaneStatus, 'idle'>, string> = {
    working: 'An agent is working',
    input: 'An agent needs input',
    error: 'A turn failed',
  };

  let {
    sessions,
    current,
    statusOf,
    setupOf,
    onopen,
    onnew,
    onarchive,
    onrestore,
  }: {
    /** The current project's workspaces, archived ones included. */
    sessions: Session[];
    current?: Session;
    /** The most pressing status among the workspace's panes. */
    statusOf: (sessionId: string) => PaneStatus;
    setupOf: (sessionId: string) => SetupStatus | undefined;
    onopen: (id: string) => void;
    onnew: () => void;
    onarchive: (id: string) => void;
    onrestore: (id: string) => void;
  } = $props();

  let menuOpen = $state(false);
  let showArchived = $state(false);

  /** The project folder first, then the newest workspaces. */
  const open = $derived(
    sessions
      .filter((session) => !session.archived)
      .sort(
        (first, second) =>
          Number(isWorktree(first)) - Number(isWorktree(second)) ||
          second.createdAt - first.createdAt,
      ),
  );
  const archived = $derived(
    sessions
      .filter((session) => session.archived)
      .sort((first, second) => second.lastOpenedAt - first.lastOpenedAt),
  );
  const shortcut = isMac() ? '⇧⌘N' : 'Ctrl+Shift+N';
</script>

{#snippet statusDot(session: Session)}
  {@const status = statusOf(session.id)}
  {@const setup = setupOf(session.id)}
  {#if status !== 'idle'}
    <span
      class={cn('size-2 shrink-0 rounded-full', STATUS_DOTS[status])}
      title={STATUS_LABELS[status]}
    ></span>
  {:else if setup === 'running'}
    <span
      class="size-2 shrink-0 animate-pulse rounded-full bg-muted-foreground motion-reduce:animate-none"
      title="Setting up"
    ></span>
  {:else if setup === 'failed'}
    <span
      class="size-2 shrink-0 rounded-full bg-destructive"
      title="Setup failed"
    ></span>
  {/if}
{/snippet}

<DropdownMenu.Root
  bind:open={menuOpen}
  onOpenChange={(next) => next && (showArchived = false)}
>
  <DropdownMenu.Trigger
    class={cn(
      buttonVariants({ variant: 'secondary' }),
      'h-7.5 min-w-0 gap-2 py-0 pr-2.5 pl-2.5',
    )}
    disabled={!current}
  >
    <Icon name="workspace" class="size-4 shrink-0 text-muted-foreground" />
    <span class="max-w-64 truncate">
      {current ? workspaceLabel(current) : 'No workspace'}
    </span>
    {#if current?.branch}
      <span
        class="max-w-56 truncate text-muted-foreground"
        title={current.branch}
      >
        {current.branch}
      </span>
    {/if}
    <ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="start" class="max-h-[70vh] w-96">
    {#each open as session (session.id)}
      <DropdownMenu.Item class="gap-2" onclick={() => onopen(session.id)}>
        <Icon name="workspace" class="size-4 shrink-0 text-muted-foreground" />
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="flex min-w-0 items-center gap-2">
            <span class="truncate">{workspaceLabel(session)}</span>
            {@render statusDot(session)}
          </span>
          <span class="truncate text-xs text-muted-foreground">
            {[session.branch, session.title ? session.name : undefined]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        {#if isWorktree(session)}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <button
                  {...props}
                  type="button"
                  class="-my-0.5 -mr-0.5 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 group-hover/dropdown-menu-item:opacity-100 group-data-highlighted/dropdown-menu-item:opacity-100 hover:bg-muted hover:text-foreground aria-expanded:opacity-100"
                  aria-label={`Actions for ${workspaceLabel(session)}`}
                  onclick={(event) => event.stopPropagation()}
                >
                  <Icon name="dots" class="size-4" />
                </button>
              {/snippet}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
              <DropdownMenu.Item
                variant="destructive"
                onclick={() => {
                  menuOpen = false;
                  onarchive(session.id);
                }}
              >
                <Icon name="archive" /> Archive
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        {/if}
      </DropdownMenu.Item>
    {/each}
    <DropdownMenu.Separator />
    <DropdownMenu.Item class="gap-2" onclick={onnew}>
      <Icon name="plus" class="size-4" /> Workspace
      <span class="ml-auto text-xs text-muted-foreground">{shortcut}</span>
    </DropdownMenu.Item>
    {#if archived.length}
      <DropdownMenu.Item
        class="gap-2"
        onSelect={(event) => {
          // Expanding the list keeps the menu open.
          event.preventDefault();
          showArchived = !showArchived;
        }}
      >
        <Icon name="archive" class="size-4" /> Archived ({archived.length})
        <ChevronDown
          class={cn(
            'ml-auto size-3.5 text-muted-foreground transition-transform',
            showArchived && 'rotate-180',
          )}
        />
      </DropdownMenu.Item>
      {#if showArchived}
        {#each archived as session (session.id)}
          <DropdownMenu.Item
            class="gap-2 pl-7"
            onclick={() => onrestore(session.id)}
          >
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate">{workspaceLabel(session)}</span>
              <span class="truncate text-xs text-muted-foreground">
                {session.branch}
              </span>
            </span>
            <span class="text-xs text-muted-foreground">Restore</span>
          </DropdownMenu.Item>
        {/each}
      {/if}
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
