<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { cn, type WithElementRef } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    value = $bindable(),
    class: className,
    ...restProps
  }: WithElementRef<HTMLInputAttributes> = $props();
</script>

<input
  bind:this={ref}
  bind:value
  data-slot="input"
  class={cn(
    'border-input placeholder:text-muted-foreground dark:bg-input/30 focus-visible:border-brand w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-1.5 text-sm leading-5 transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50',
    className,
  )}
  {...restProps}
/>
