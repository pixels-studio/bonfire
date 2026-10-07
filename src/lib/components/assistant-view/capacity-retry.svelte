<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import { Button } from '$lib/components/ui/button';

  const SECONDS = 20;

  let { message, onretry }: { message: string; onretry: () => void } =
    $props();

  let remaining = $state(SECONDS);
  let filling = $state(false);
  let tick: ReturnType<typeof setInterval> | undefined;
  let auto: ReturnType<typeof setTimeout> | undefined;

  function retry() {
    clearInterval(tick);
    clearTimeout(auto);
    onretry();
  }

  onMount(() => {
    // Starts a frame late, so the width-to-full transition has a 0% state to animate from.
    const raf = requestAnimationFrame(() => (filling = true));
    tick = setInterval(() => (remaining = Math.max(0, remaining - 1)), 1000);
    auto = setTimeout(retry, SECONDS * 1000);
    return () => cancelAnimationFrame(raf);
  });

  onDestroy(() => {
    clearInterval(tick);
    clearTimeout(auto);
  });
</script>

<section
  class="flex flex-col gap-3 rounded-xl bg-composer p-4 text-sm"
  role="alert"
>
  <p class="flex items-start gap-2.5 text-muted-foreground">
    <CircleAlert class="mt-0.5 size-4 shrink-0" />
    <span>{message}</span>
  </p>
  <Button
    variant="secondary"
    class="relative isolate overflow-hidden"
    onclick={retry}
  >
    <span
      class="absolute inset-0 origin-left bg-brand/25 motion-safe:transition-transform motion-safe:ease-linear"
      style:transition-duration={filling ? `${SECONDS}s` : '0s'}
      style:transform={filling ? 'scaleX(1)' : 'scaleX(0)'}
      aria-hidden="true"
    ></span>
    <span class="relative">Retry in {remaining}s</span>
  </Button>
</section>
