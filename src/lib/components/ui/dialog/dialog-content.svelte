<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: DialogPrimitive.ContentProps = $props();
</script>

<DialogPrimitive.Portal>
  <DialogPrimitive.Overlay
    data-slot="dialog-overlay"
    class="overlay-motion fixed inset-0 z-50 bg-black/60"
  />
  <DialogPrimitive.Content
    bind:ref
    data-slot="dialog-content"
    class={cn(
      'bg-popover text-popover-foreground ring-foreground/10 dialog-motion fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-4rem)] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl text-sm shadow-2xl ring-1 outline-hidden',
      className,
    )}
    {...restProps}
  >
    {@render children?.()}
  </DialogPrimitive.Content>
</DialogPrimitive.Portal>
