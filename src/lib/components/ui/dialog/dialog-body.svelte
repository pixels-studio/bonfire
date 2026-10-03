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
  data-slot="dialog-body"
  class={cn('flex flex-col gap-4 px-8 py-4', className)}
  {...restProps}
>
  {@render children?.()}
</div>
