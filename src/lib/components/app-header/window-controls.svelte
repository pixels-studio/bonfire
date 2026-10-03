<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import Icon from '$lib/components/icon/icon.svelte';

  let fullscreen = $state(false);

  const CONTROLS = $derived([
    {
      icon: 'minimize',
      label: 'Minimize',
      tint: 'text-[#febc2e]',
      run: () => window.bonfire.window.minimize(),
    },
    {
      icon: 'maximize',
      label: fullscreen ? 'Exit full screen' : 'Enter full screen',
      tint: 'text-[#28c840]',
      run: () => window.bonfire.window.toggleFullscreen(),
    },
    {
      icon: 'close',
      label: 'Close',
      tint: 'text-[#ff5f57]',
      run: () => window.bonfire.window.close(),
    },
  ]);

  onMount(() => {
    window.bonfire.app.isFullscreen().then((value) => (fullscreen = value));
    return window.bonfire.app.onFullscreenChange(
      (value) => (fullscreen = value),
    );
  });
</script>

<div class="flex items-center gap-3 app-no-drag">
  {#each CONTROLS as control (control.label)}
    <Button
      variant="secondary"
      size="icon"
      aria-label={control.label}
      onclick={control.run}
    >
      <Icon name={control.icon} class={control.tint} />
    </Button>
  {/each}
</div>
