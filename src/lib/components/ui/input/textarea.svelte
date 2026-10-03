<script lang="ts">
  import type { HTMLTextareaAttributes } from 'svelte/elements';
  import { cn, type WithElementRef } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    value = $bindable(),
    class: className,
    ...restProps
  }: WithElementRef<HTMLTextareaAttributes> = $props();
</script>

<textarea
  bind:this={ref}
  bind:value
  data-slot="textarea"
  class={cn(
    'border-input placeholder:text-muted-foreground dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 w-full min-w-0 resize-y rounded-lg border bg-transparent px-2.5 py-1.5 text-sm leading-5 transition-colors outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50',
    className,
  )}
  {...restProps}></textarea>
