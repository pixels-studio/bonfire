<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import Icon from '$lib/components/icon/icon.svelte';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { cn } from '$lib/utils';

  let {
    name,
    previewUrl,
    onremove,
    class: className,
  }: {
    name: string;
    previewUrl?: string;
    /** Swaps the icon for a remove button on hover when set. */
    onremove?: () => void;
    class?: string;
  } = $props();
</script>

{#snippet chip()}
  <span
    class={cn(
      'group inline-flex h-6.5 max-w-48 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background/40 px-1.5 align-middle text-xs text-foreground transition-colors hover:border-foreground/40',
      className,
    )}
    title={onremove ? undefined : name}
  >
    <span class="relative grid size-4 shrink-0 place-items-center">
      {#if previewUrl}
        <img
          class={cn(
            'size-4 rounded-xs object-cover',
            onremove && 'group-hover:invisible',
          )}
          src={previewUrl}
          alt=""
        />
      {:else}
        <Icon
          name="file"
          class={cn('size-4', onremove && 'group-hover:invisible')}
        />
      {/if}
      {#if onremove}
        <button
          type="button"
          class="invisible absolute inset-0 grid place-items-center rounded-full bg-secondary text-secondary-foreground group-hover:visible hover:bg-foreground/20"
          aria-label={`Remove ${name}`}
          onclick={onremove}
        >
          <X class="size-3.5" />
        </button>
      {/if}
    </span>
    <span class="truncate">{name}</span>
  </span>
{/snippet}

{#if previewUrl}
  <!-- Mounted outside the app's tree when it's a composer node view, so it brings its own provider. -->
  <Tooltip.Provider>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <span {...props} class="inline-flex align-middle">
            {@render chip()}
          </span>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content
        side="top"
        class="max-w-none rounded-lg bg-popover p-1 text-popover-foreground ring-1 ring-foreground/10"
      >
        <img
          src={previewUrl}
          alt={name}
          class="max-h-72 max-w-96 rounded-sm object-contain"
        />
      </Tooltip.Content>
    </Tooltip.Root>
  </Tooltip.Provider>
{:else}
  {@render chip()}
{/if}
