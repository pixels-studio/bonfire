<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import Icon from '$lib/components/icon/icon.svelte';
  import ShortcutKeys from '$lib/components/shortcuts/shortcut-keys.svelte';
  import { PANE_SIZES, type PaneSize } from '$lib/panes';

  let {
    label,
    size,
    onresize,
    items,
  }: {
    /** What the trigger is announced as, e.g. "Terminal options". */
    label: string;
    /** The pane's current size, left out of the list of sizes to switch to. */
    size: PaneSize;
    onresize: (size: PaneSize) => void;
    /** Pane-specific menu items, shown after the sizes. */
    items?: Snippet;
  } = $props();

  const otherSizes = $derived(PANE_SIZES.filter((item) => item.value !== size));
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="secondary"
        size="icon"
        class="shrink-0 text-muted-foreground hover:text-foreground"
        aria-label={label}
      >
        <Icon name="dots" />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="w-48">
    <DropdownMenu.Label class="flex items-center justify-between">
      Pane size
      <ShortcutKeys id="resizePane" />
    </DropdownMenu.Label>
    {#each otherSizes as option (option.value)}
      <DropdownMenu.Item onclick={() => onresize(option.value)}>
        <Icon name={option.icon} />
        {option.label}
      </DropdownMenu.Item>
    {/each}
    {#if items}
      <DropdownMenu.Separator />
      {@render items()}
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
