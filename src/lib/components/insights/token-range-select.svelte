<script lang="ts">
  import * as Select from '$lib/components/ui/select';
  import { tokens } from '$lib/stores/tokens.svelte';
  import type { TokenRange } from '$shared/contracts';

  const RANGES: { value: TokenRange; label: string }[] = [
    { value: 'today', label: 'Today' },
    { value: '7d', label: '7 days' },
    { value: '30d', label: '30 days' },
  ];
</script>

<Select.Root
  type="single"
  items={RANGES}
  value={tokens.range}
  onValueChange={(value) => tokens.select(value as TokenRange)}
>
  <Select.Trigger
    aria-label="Time range"
    class="h-auto border-0 bg-transparent px-2 py-1 text-sm font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground dark:bg-transparent dark:hover:bg-secondary"
  >
    <Select.Value placeholder="Today" />
  </Select.Trigger>
  <Select.Content>
    {#each RANGES as range (range.value)}
      <Select.Item value={range.value} label={range.label}>
        {range.label}
      </Select.Item>
    {/each}
  </Select.Content>
</Select.Root>
