<script lang="ts">
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import Icon from '$lib/components/icon/icon.svelte';
  import { tokens } from '$lib/stores/tokens.svelte';
  import { cn } from '$lib/utils';
  import type { TokenRange } from '$shared/contracts';

  const RANGES: { value: TokenRange; label: string }[] = [
    { value: 'today', label: 'Today' },
    { value: '7d', label: '7 days' },
    { value: '30d', label: '30 days' },
  ];

  const current = $derived(
    RANGES.find((range) => range.value === tokens.range) ?? RANGES[0],
  );
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class="group/range flex items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 py-1 text-sm leading-5 font-semibold text-muted-foreground transition-colors outline-none select-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 aria-expanded:bg-secondary aria-expanded:text-foreground"
    aria-label="Time range"
  >
    {current.label}
    <Icon
      name="chevron-down"
      class="size-3.5 transition-transform duration-200 ease-out group-aria-expanded/range:rotate-180 motion-reduce:transition-none"
    />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="start" class="w-36">
    {#each RANGES as range (range.value)}
      <DropdownMenu.Item
        class="justify-between"
        onclick={() => tokens.select(range.value)}
      >
        <span class={cn(range.value !== current.value && 'text-foreground/80')}>
          {range.label}
        </span>
        {#if range.value === current.value}
          <Icon name="check" class="size-4" />
        {/if}
      </DropdownMenu.Item>
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
