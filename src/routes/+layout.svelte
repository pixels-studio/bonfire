<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Toast from '$lib/components/ui/toast/toast.svelte';
  import ImageLightbox from '$lib/components/conversation/image-lightbox.svelte';
  import { connections } from '$lib/stores/connections.svelte';
  import { preferences } from '$lib/stores/preferences.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { errorMessage } from '$shared/domain';
  let { children } = $props();

  // Main writes lines starting with [perf] to bonfire.log, which says what a freeze was.
  onMount(() => {
    if (!('PerformanceObserver' in window)) return;
    const observer = new PerformanceObserver((list) => {
      for (const { duration } of list.getEntries())
        if (duration >= 300) {
          const panes = document.querySelectorAll('[data-pane-id]').length;
          const panels = document.querySelectorAll('[data-panel]').length;
          console.warn(
            `[perf] Page busy for ${Math.round(duration)} ms (${panes} panes, ${panels} panels)`,
          );
        }
    });
    try {
      observer.observe({ type: 'longtask', buffered: false });
    } catch {
      return;
    }
    return () => observer.disconnect();
  });

  onMount(() => {
    Promise.all([preferences.load(), connections.load()]).catch((cause) =>
      toast(errorMessage(cause), { variant: 'error' }),
    );
  });
</script>

<Tooltip.Provider>
  {@render children()}
</Tooltip.Provider>
<Toast />
<ImageLightbox />
