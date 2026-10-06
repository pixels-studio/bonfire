<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '$lib/components/icon/icon.svelte';
  import { cn } from '$lib/utils.js';

  let {
    icon,
    media,
    title,
    description,
    class: className,
    children,
  }: {
    /** Name of a sprite icon. */
    icon?: string;
    /** Custom icon, for glyphs that aren't in the sprite. */
    media?: Snippet;
    title: string;
    description?: string;
    class?: string;
    children?: Snippet;
  } = $props();
</script>

<div
  class={cn(
    'flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground',
    className,
  )}
>
  {#if media}
    {@render media()}
  {:else if icon}
    <Icon name={icon} class="size-6 opacity-60" />
  {/if}
  <div class="flex flex-col items-center gap-1">
    <p class="text-sm font-medium text-foreground">{title}</p>
    {#if description}
      <p class="max-w-65 text-sm text-pretty">{description}</p>
    {/if}
  </div>
  {@render children?.()}
</div>
