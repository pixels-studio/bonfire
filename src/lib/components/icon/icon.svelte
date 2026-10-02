<script lang="ts">
  import { cn } from '$lib/utils.js';
  import type { SVGAttributes } from 'svelte/elements';

  let {
    name,
    class: className,
    ...restProps
  }: { name: string } & SVGAttributes<SVGSVGElement> = $props();
</script>

<svg
  class={cn('size-4', className)}
  viewBox="0 0 24 24"
  fill="currentColor"
  aria-hidden="true"
  {...restProps}
>
  <use href={`/icons/sprite.svg#${name}`} />
</svg>
