<script lang="ts" module>
  const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];

  /** "just now", "5 minutes ago", "yesterday". */
  function closedAgo(at: number, now = Date.now()) {
    const elapsed = now - at;
    for (const [unit, size] of UNITS)
      if (elapsed >= size)
        return RELATIVE.format(-Math.floor(elapsed / size), unit);
    return 'just now';
  }
</script>

<script lang="ts">
  import { buttonVariants } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import Icon from '$lib/components/icon/icon.svelte';
  import { paneIcon } from '$lib/panes';
  import { shortcutText } from '$lib/shortcuts';
  import { cn, isMac } from '$lib/utils';
  import type { Pane } from '$shared/contracts';
  import HeaderTip from './header-tip.svelte';

  let {
    panes,
    onrestore,
  }: {
    /** The project's closed panes that can be reopened, most recently closed first. */
    panes: Pane[];
    onrestore: (id: string) => void;
  } = $props();

  let open = $state(false);
  const tip = `Recently closed (${shortcutText('reopenPane', isMac())} reopens the last)`;
</script>

<DropdownMenu.Root bind:open>
  <HeaderTip text={open ? '' : tip}>
    <DropdownMenu.Trigger
      class={cn(
        buttonVariants({
          variant: open ? 'default' : 'secondary',
          size: 'icon-sm',
        }),
        !open && 'text-muted-foreground hover:text-foreground',
      )}
      aria-label="Recently closed panes"
    >
      <Icon name="history" />
    </DropdownMenu.Trigger>
  </HeaderTip>
  <DropdownMenu.Content align="end" class="max-h-96 w-80">
    <DropdownMenu.Label>Recently closed</DropdownMenu.Label>
    {#each panes as pane (pane.id)}
      <DropdownMenu.Item class="gap-2.5" onclick={() => onrestore(pane.id)}>
        <Icon
          name={paneIcon(pane.type)}
          class="shrink-0 text-muted-foreground"
        />
        <span class="min-w-0 flex-1 truncate">{pane.title}</span>
        {#if pane.closedAt}
          <span class="shrink-0 text-xs text-muted-foreground">
            {closedAgo(pane.closedAt)}
          </span>
        {/if}
      </DropdownMenu.Item>
    {:else}
      <p class="px-2 py-1.5 text-sm text-muted-foreground">
        Panes you close show up here.
      </p>
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
