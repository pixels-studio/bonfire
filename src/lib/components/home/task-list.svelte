<script lang="ts" module>
  import type { WorkspaceStatus } from '$shared/contracts';
  import type { PaneStatus } from '$lib/pane-status.svelte';

  /** A task still being set up: its worktree is being made. */
  export type PendingTask = { key: string; request: string; base?: string };

  const SECTIONS: { status: WorkspaceStatus; label: string }[] = [
    { status: 'in_progress', label: 'In progress' },
    { status: 'done', label: 'Done' },
    { status: 'archived', label: 'Closed' },
  ];

  const ACTIVITY_DOTS: Record<Exclude<PaneStatus, 'idle'>, string> = {
    working: 'bg-amber-400 dot-working',
    input: 'bg-orange-500',
    error: 'bg-destructive',
    done: 'bg-lime-400',
  };
  /** The outline a task row takes on hover, in its status dot's color. */
  const ACTIVITY_RINGS: Record<PaneStatus, string> = {
    idle: 'hover:ring-muted-foreground/40',
    working: 'hover:ring-amber-400',
    input: 'hover:ring-orange-500',
    error: 'hover:ring-destructive',
    done: 'hover:ring-lime-400',
  };
  const ACTIVITY_LABELS: Record<Exclude<PaneStatus, 'idle'>, string> = {
    working: 'The agent is working',
    input: 'The agent is waiting for you',
    error: 'The agent failed',
    done: 'The agent finished',
  };

  /** The view-transition name that joins a task's row to the task view's header. */
  export function taskMorphName(id: string) {
    return `task-${id.replace(/[^\w-]/g, '')}`;
  }
</script>

<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import Icon from '$lib/components/icon/icon.svelte';
  import { cn } from '$lib/utils';
  import { workspaceLabel } from '$shared/domain';
  import type { Workspace } from '$shared/contracts';

  let {
    workspaces,
    pending = [],
    activity = {},
    morphingId,
    onopen,
    onrename,
    onarchive,
    onunarchive,
    ondelete,
  }: {
    /** The project's workspaces; its main one is left out. */
    workspaces: Workspace[];
    pending?: PendingTask[];
    /** What each task's agents are doing, by workspace id. */
    activity?: Record<string, PaneStatus>;
    /** The task opening, whose row morphs into the task view's header. */
    morphingId?: string;
    onopen: (id: string) => void;
    onrename: (id: string, title: string) => void;
    onarchive: (id: string) => void;
    onunarchive: (id: string) => void;
    ondelete: (id: string) => void;
  } = $props();

  /** Newest first in each section, as the latest work is the likeliest to be picked. */
  const sections = $derived(
    SECTIONS.map((section) => ({
      ...section,
      items: workspaces
        .filter((item) => !item.main && item.status === section.status)
        .toSorted((a, b) => b.createdAt - a.createdAt),
    })),
  );

  let renamingId = $state<string>();
  let draft = $state('');
  let deleting = $state<Workspace>();

  function startRename(workspace: Workspace) {
    draft = workspaceLabel(workspace);
    renamingId = workspace.id;
  }

  function finishRename(save: boolean) {
    const id = renamingId;
    renamingId = undefined;
    const title = draft.trim();
    const workspace = workspaces.find((item) => item.id === id);
    if (save && id && title && workspace && title !== workspaceLabel(workspace))
      onrename(id, title);
  }

  function focusAndSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.35],
    ['month', 12],
    ['year', Infinity],
  ];

  /** "5 minutes ago", "yesterday" and the like. */
  function since(time: number) {
    let value = (time - Date.now()) / 60_000;
    if (Math.abs(value) < 1) return 'just now';
    for (const [unit, size] of STEPS) {
      if (Math.abs(value) < size)
        return relative.format(Math.round(value), unit);
      value /= size;
    }
    return '';
  }

  const ROW_CLASS =
    'group/row relative flex min-h-13 w-full min-w-0 items-center gap-3 rounded-lg bg-card px-4 py-2.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60';
</script>

{#snippet marker(status: PaneStatus | undefined, class_?: string)}
  {@const active = status && status !== 'idle'}
  <span class={cn('grid size-4 shrink-0 place-content-center', class_)}>
    <span
      class={cn(
        'size-2 rounded-full',
        active ? ACTIVITY_DOTS[status] : 'bg-muted-foreground/40',
      )}
      role="img"
      aria-label={active ? ACTIVITY_LABELS[status] : 'Idle'}
      title={active ? ACTIVITY_LABELS[status] : 'Idle'}
    ></span>
  </span>
{/snippet}

{#snippet row(workspace: Workspace)}
  {@const label = workspaceLabel(workspace)}
  <li class="relative">
    {#if renamingId === workspace.id}
      <div class={ROW_CLASS}>
        {@render marker(activity[workspace.id])}
        <input
          class="-my-0.5 h-7 min-w-0 flex-1 rounded-md bg-background px-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          aria-label="Task title"
          maxlength={200}
          spellcheck="false"
          autocomplete="off"
          bind:value={draft}
          use:focusAndSelect
          onkeydown={(event) => {
            if (event.key === 'Enter') finishRename(true);
            else if (event.key === 'Escape') {
              event.stopPropagation();
              finishRename(false);
            }
          }}
          onblur={() => finishRename(true)}
        />
      </div>
    {:else}
      <button
        type="button"
        class={cn(
          ROW_CLASS,
          'pr-12 ring-1 ring-transparent ring-inset hover:bg-secondary/60',
          ACTIVITY_RINGS[activity[workspace.id] ?? 'idle'],
          workspace.status === 'archived' && 'text-muted-foreground',
        )}
        style:view-transition-name={morphingId === workspace.id
          ? taskMorphName(workspace.id)
          : undefined}
        onclick={() => onopen(workspace.id)}
        ondblclick={() => startRename(workspace)}
      >
        {@render marker(activity[workspace.id], 'h-5 self-start')}
        <span class="flex min-w-0 flex-1 flex-col items-start">
          <span class="max-w-full truncate">{label}</span>
          <span
            class="max-w-full truncate text-xs leading-tight text-muted-foreground"
          >
            {workspace.branch}
          </span>
        </span>
        <span class="w-24 shrink-0 text-right text-xs text-muted-foreground">
          {since(workspace.createdAt)}
        </span>
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              type="button"
              class="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted"
              aria-label={`Actions for ${label}`}
            >
              <Icon name="dots" class="size-4" />
            </button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="w-44">
          <DropdownMenu.Item onclick={() => startRename(workspace)}>
            <Icon name="edit" /> Rename
          </DropdownMenu.Item>
          {#if workspace.status === 'archived'}
            <DropdownMenu.Item onclick={() => onunarchive(workspace.id)}>
              <Icon name="revert" /> Unarchive
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              variant="destructive"
              onclick={() => (deleting = workspace)}
            >
              <Icon name="trash" /> Delete…
            </DropdownMenu.Item>
          {:else}
            <DropdownMenu.Item onclick={() => onarchive(workspace.id)}>
              <Icon name="close-panes" /> Archive
            </DropdownMenu.Item>
          {/if}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
  </li>
{/snippet}

<div class="flex flex-col gap-10">
  {#each sections as section (section.status)}
    {@const waiting = section.status === 'in_progress' ? pending : []}
    {#if section.items.length || waiting.length}
      <section aria-labelledby={`tasks-${section.status}`}>
        <h2
          id={`tasks-${section.status}`}
          class="mb-3 px-1 text-sm text-muted-foreground"
        >
          {section.label}
        </h2>
        <ul class="flex flex-col gap-2">
          {#each waiting as task (task.key)}
            <li>
              <div
                class={cn(ROW_CLASS, 'text-muted-foreground')}
                aria-busy="true"
              >
                <span class="grid size-4 shrink-0 place-content-center">
                  <span
                    class="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground motion-reduce:animate-pulse"
                  ></span>
                </span>
                <span class="min-w-0 flex-1 truncate">{task.request}</span>
                <span class="shrink-0 text-xs">Making a worktree…</span>
              </div>
            </li>
          {/each}
          {#each section.items as workspace (workspace.id)}
            {@render row(workspace)}
          {/each}
        </ul>
      </section>
    {/if}
  {/each}
</div>

<Dialog.Root
  open={!!deleting}
  onOpenChange={(open) => {
    if (!open) deleting = undefined;
  }}
>
  <Dialog.Content class="w-[min(28rem,calc(100vw-2rem))] gap-0 p-0">
    <Dialog.Header>
      <Dialog.Title class="text-lg font-semibold">
        Delete {deleting ? workspaceLabel(deleting) : 'task'}?
      </Dialog.Title>
    </Dialog.Header>
    <Dialog.Body>
      <Dialog.Description class="text-sm text-pretty text-muted-foreground">
        Its branch <span class="font-mono text-foreground"
          >{deleting?.branch}</span
        >, any work saved when it was archived, and its conversations are
        deleted for good. Work already pushed stays on the remote.
      </Dialog.Description>
    </Dialog.Body>
    <Dialog.Footer>
      <Button
        variant="secondary"
        class="min-w-20"
        onclick={() => (deleting = undefined)}
      >
        Cancel
      </Button>
      <Button
        variant="destructive"
        class="min-w-20"
        onclick={() => {
          if (deleting) ondelete(deleting.id);
          deleting = undefined;
        }}
      >
        Delete
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
