<script lang="ts">
  /**
   * The wallpaper behind the whole window. The project home shows the photo under a scrim.
   * Inside a task the photo gives way to its gradient (see `src/lib/wallpapers.ts`), which keeps
   * its colors at a fraction of the cost: no blur, nothing to resample, and the panes above sit
   * on flat color instead of frosted glass.
   */
  import type { Wallpaper } from '$lib/wallpapers';

  let { wallpaper, depth = false }: { wallpaper: Wallpaper; depth?: boolean } =
    $props();
</script>

{#if wallpaper.src}
  <div
    class="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    aria-hidden="true"
  >
    <img
      src={wallpaper.src}
      alt=""
      draggable="false"
      decoding="async"
      class="size-full object-cover"
    />
    <div class="absolute inset-0 bg-black/50"></div>
    <div
      class="absolute inset-0 bg-linear-to-b from-black/40 via-transparent to-black/30"
    ></div>
    <!-- Over the photo rather than in place of it, so going in and out of a task is one fade. -->
    <div
      class="absolute inset-0 transition-opacity duration-500 ease-out motion-reduce:transition-none {depth
        ? 'opacity-100'
        : 'opacity-0'}"
      style:background={wallpaper.gradient}
    ></div>
  </div>
{/if}
