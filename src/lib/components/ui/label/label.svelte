<script lang="ts">
  import { cn } from '$lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    class: className,
    children,
    ...restProps
  }: HTMLAttributes<HTMLSpanElement> = $props();
</script>

<span
  data-slot="label"
  class={cn('text-sm text-muted-foreground', className)}
  {...restProps}
>
  {@render children?.()}
</span>
