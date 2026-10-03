<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import Icon from '$lib/components/icon/icon.svelte';
  import { cn } from '$lib/utils';

  let {
    name,
    previewUrl,
    onremove,
    class: className,
  }: {
    name: string;
    previewUrl?: string;
    /** Shows a remove button when set. */
    onremove?: () => void;
    class?: string;
  } = $props();
</script>

<span
  class={cn(
    'inline-flex h-6.5 max-w-48 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background/40 px-1.5 align-middle text-xs text-foreground',
    className,
  )}
  title={name}
>
  {#if previewUrl}
    <img
      class="size-4 shrink-0 rounded-xs object-cover"
      src={previewUrl}
      alt=""
    />
  {:else}
    <Icon name="file" class="size-4 shrink-0" />
  {/if}
  <span class="truncate">{name}</span>
  {#if onremove}
    <button
      type="button"
      class="grid shrink-0 place-items-center rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label={`Remove ${name}`}
      onclick={onremove}
    >
      <X class="size-3" />
    </button>
  {/if}
</span>
