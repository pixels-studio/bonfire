<script lang="ts">
  import { tick } from 'svelte';
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import Download from '@lucide/svelte/icons/download';
  import X from '@lucide/svelte/icons/x';
  import { Button } from '$lib/components/ui/button';
  import { lightbox, type LightboxImage } from '$lib/stores/lightbox.svelte';
  import { reducedMotion } from '$lib/utils';

  const MORPH_EASING = 'cubic-bezier(0.19, 1, 0.22, 1)';
  /** Matches `dialog-in`'s duration in app.css, so the frame and the image settle together. */
  const MORPH_ENTER_MS = 200;
  /**
   * Matches `dialog-out`'s duration in app.css: bits-ui waits for the Content element's own
   * exit animation before it unmounts, so a longer morph here would be cut off mid-flight.
   */
  const MORPH_EXIT_MS = 150;

  const open = $derived(!!lightbox.open);
  // Kept across the close animation, since `lightbox.open` already cleared by then; the
  // dialog unmounts for real only once bits-ui sees its own exit animation finish.
  let snapshot = $state<LightboxImage>();
  let imgEl = $state<HTMLImageElement>();

  /** Morphs the image between its thumbnail's rect and where it now sits, GPU-only. */
  function morph(from: 'origin' | 'here') {
    const img = imgEl;
    const origin = snapshot?.origin;
    if (!img || !origin || reducedMotion()) return;
    const here = img.getBoundingClientRect();
    const dx = origin.left + origin.width / 2 - (here.left + here.width / 2);
    const dy = origin.top + origin.height / 2 - (here.top + here.height / 2);
    const originKeyframe = {
      transform: `translate(${dx}px, ${dy}px) scale(${origin.width / here.width}, ${origin.height / here.height})`,
    };
    const hereKeyframe = { transform: 'translate(0, 0) scale(1, 1)' };
    img.animate(
      from === 'origin'
        ? [originKeyframe, hereKeyframe]
        : [hereKeyframe, originKeyframe],
      {
        duration: from === 'origin' ? MORPH_ENTER_MS : MORPH_EXIT_MS,
        easing: MORPH_EASING,
        fill: 'both',
      },
    );
  }

  $effect(() => {
    const next = lightbox.open;
    if (!next) {
      // Still mounted here: the dialog waits for this to finish before it really closes.
      morph('here');
      return;
    }
    snapshot = next;
    void (async () => {
      await tick();
      // Waits for the swapped-in image to have its real, laid-out size to morph to.
      if (imgEl && !imgEl.complete) await imgEl.decode().catch(() => {});
      requestAnimationFrame(() => morph('origin'));
    })();
  });

  function download() {
    if (!snapshot) return;
    const link = document.createElement('a');
    link.href = snapshot.src;
    link.download = snapshot.alt || 'image';
    link.click();
  }
</script>

<DialogPrimitive.Root
  {open}
  onOpenChange={(next) => {
    if (!next) lightbox.close();
  }}
>
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      class="overlay-motion fixed inset-0 z-50 bg-black/85"
    />
    <DialogPrimitive.Content
      class="dialog-motion fixed inset-0 z-50 flex flex-col items-center justify-center p-8 outline-hidden"
      onclick={(event) => {
        // Content fills the screen, so there's no separate overlay element to click for
        // bits-ui's own outside-click handling to catch; a click that isn't on a child is it.
        if (event.target === event.currentTarget) lightbox.close();
      }}
    >
      {#if snapshot}
        <DialogPrimitive.Title class="sr-only">
          {snapshot.alt || 'Image'}
        </DialogPrimitive.Title>
        <img
          bind:this={imgEl}
          src={snapshot.src}
          alt={snapshot.alt ?? ''}
          class="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
        />
        <div class="absolute top-4 right-4 flex items-center gap-3">
          <Button
            variant="secondary"
            size="icon"
            aria-label="Download image"
            onclick={download}
          >
            <Download />
          </Button>
          <DialogPrimitive.Close>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="secondary"
                size="icon"
                aria-label="Close"
              >
                <X />
              </Button>
            {/snippet}
          </DialogPrimitive.Close>
        </div>
      {/if}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
</DialogPrimitive.Root>
