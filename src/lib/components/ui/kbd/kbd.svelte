<script lang="ts">
  import { cn } from '$lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    class: className,
    children,
    ...restProps
  }: HTMLAttributes<HTMLElement> = $props();
</script>

<kbd
  data-slot="kbd"
  class={cn(
    'pointer-events-none inline-flex h-5.5 min-w-5.5 items-center justify-center rounded-md bg-secondary px-1.5 font-sans text-[11px] font-medium text-muted-foreground select-none',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</kbd>
