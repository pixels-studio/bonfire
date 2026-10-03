<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import Icon from '$lib/components/icon/icon.svelte';
  import ShortcutKeys from '$lib/components/shortcuts/shortcut-keys.svelte';
  import { PANE_SIZES, type PaneSize } from '$lib/panes';

  let {
    label,
    onresize,
    onclose,
  }: {
    /** What the trigger is announced as, e.g. "Terminal options". */
    label: string;
    onresize: (size: PaneSize) => void;
    onclose: () => void;
  } = $props();
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
  <DropdownMenu.Content align="end" class="w-56">
    <DropdownMenu.Label>Pane size</DropdownMenu.Label>
    {#each PANE_SIZES as size (size.value)}
      <DropdownMenu.Item onclick={() => onresize(size.value)}>
        <Icon name={size.icon} />
        {size.label}
      </DropdownMenu.Item>
    {/each}
    <DropdownMenu.Separator />
    <DropdownMenu.Item variant="destructive" onclick={onclose}>
      <Icon name="close" /> Close
      <ShortcutKeys id="closePane" class="ml-auto" />
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
