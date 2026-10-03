<script lang="ts">
  import { cn } from '$lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    class: className,
    children,
    ...restProps
  }: HTMLAttributes<HTMLDivElement> = $props();
</script>

<div
  data-slot="dialog-header"
  class={cn('flex shrink-0 items-center px-8 py-4', className)}
  {...restProps}
>
  {@render children?.()}
</div>
