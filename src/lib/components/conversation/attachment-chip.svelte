<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import Icon from '$lib/components/icon/icon.svelte';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { lightbox, rectOf } from '$lib/stores/lightbox.svelte';
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
      'group inline-flex max-w-48 shrink-0 items-center gap-1.5 align-middle text-foreground',
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
    <span class="truncate font-semibold">{name}</span>
  </span>
{/snippet}

{#if previewUrl}
  <!-- Mounted outside the app's tree when it's a composer node view, so it brings its own provider. -->
  <Tooltip.Provider>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <!-- role and tabindex are only set without onremove, i.e. when this is a button. -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <span
            {...props}
            class={cn(
              'inline-flex align-middle',
              !onremove && 'cursor-pointer',
            )}
            role={onremove ? undefined : 'button'}
            tabindex={onremove ? undefined : 0}
            onclick={(event) => {
              if (onremove) return;
              const thumb = event.currentTarget.querySelector('img');
              lightbox.show({
                src: previewUrl,
                alt: name,
                origin: thumb ? rectOf(thumb) : undefined,
              });
            }}
            onkeydown={(event) => {
              if (onremove || (event.key !== 'Enter' && event.key !== ' '))
                return;
              event.preventDefault();
              const thumb = event.currentTarget.querySelector('img');
              lightbox.show({
                src: previewUrl,
                alt: name,
                origin: thumb ? rectOf(thumb) : undefined,
              });
            }}
          >
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
