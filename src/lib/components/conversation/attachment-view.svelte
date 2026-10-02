<script lang="ts">
  import Icon from '$lib/components/icon/icon.svelte';
  import { cn, formatBytes } from '$lib/utils';

  let {
    name,
    size,
    previewUrl,
    class: className,
  }: {
    name: string;
    size?: number;
    previewUrl?: string;
    class?: string;
  } = $props();
</script>

<div
  class={cn(
    'flex w-fit items-center gap-2.5 rounded-lg bg-surface-raised px-3 py-2.5',
    className,
  )}
>
  {#if previewUrl}
    <img
      class="size-9 shrink-0 rounded-md object-cover"
      src={previewUrl}
      alt=""
    />
  {:else}
    <Icon name="file" class="size-4.5 shrink-0" />
  {/if}
  <span class="grid min-w-0">
    <strong class="truncate">{name}</strong>
    {#if size !== undefined}
      <small class="text-xs text-muted-foreground">{formatBytes(size)}</small>
    {/if}
  </span>
</div>
