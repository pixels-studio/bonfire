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
  data-slot="dialog-footer"
  class={cn('flex shrink-0 justify-end gap-4 px-8 pt-4 pb-8', className)}
  {...restProps}
>
  {@render children?.()}
</div>
