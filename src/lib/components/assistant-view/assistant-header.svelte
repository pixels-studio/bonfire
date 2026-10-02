<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import Icon from '$lib/components/icon/icon.svelte';
  import { PANE_SIZES, type PaneSize, type PaneView } from '$lib/panes';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  const TOOL_VIEWS: { view: PaneView; icon: string; label: string }[] = [
    { view: 'files', icon: 'folder', label: 'Open file preview' },
    { view: 'terminal', icon: 'terminal', label: 'Open terminal' },
    { view: 'diff', icon: 'code', label: 'Open code diff' },
  ];

  let {
    title,
    view = $bindable(),
    toolsDisabled,
    dragHandle,
    onresize,
    onarchive,
  }: {
    title: string;
    view: PaneView;
    toolsDisabled: boolean;
    dragHandle: HTMLButtonAttributes;
    onresize: (size: PaneSize) => void;
    onarchive: () => void;
  } = $props();
</script>

<header class="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
  <div class="flex min-w-0 items-center gap-1">
    <button
      type="button"
      class="-ml-1.5 shrink-0 cursor-grab touch-none rounded-md p-0.5 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 active:cursor-grabbing"
      aria-label="Reorder pane"
      title="Drag to reorder"
      {...dragHandle}
    >
      <Icon name="drag" class="size-5" />
    </button>
    <span class="truncate text-sm" {title}>{title}</span>
  </div>
  <div class="flex items-center gap-2">
    {#each TOOL_VIEWS as tool (tool.view)}
      <Button
        variant="ghost"
        size="icon"
        class="text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
        aria-label={tool.label}
        aria-pressed={view === tool.view}
        disabled={toolsDisabled}
        onclick={() => (view = view === tool.view ? 'chat' : tool.view)}
      >
        <Icon name={tool.icon} />
      </Button>
    {/each}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon"
            class="text-muted-foreground"
            aria-label="Conversation options"
          >
            <Icon name="dots" />
          </Button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.Label>Pane size</DropdownMenu.Label>
        {#each PANE_SIZES as size (size.value)}
          <DropdownMenu.Item onclick={() => onresize(size.value)}>
            <Icon name={size.icon} />
            {size.label}
          </DropdownMenu.Item>
        {/each}
        <DropdownMenu.Separator />
        <DropdownMenu.Item variant="destructive" onclick={onarchive}>
          <Icon name="archive" /> Archive
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
</header>
