<script lang="ts">
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import Info from '@lucide/svelte/icons/info';
  import X from '@lucide/svelte/icons/x';
  import { cn } from '$lib/utils';
  import { dismissToast, toasts } from '$lib/stores/toast.svelte';
</script>

{#if toasts.length}
  <div class="fixed top-15 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">
    {#each toasts as item (item.id)}
      {@const isError = item.variant === 'error'}
      <div
        class={cn(
          'relative flex max-w-105 items-start gap-2.5 rounded-xl border border-foreground/10 bg-card py-3.5 pr-4.5 pl-4 shadow-lg',
          isError && 'bg-destructive-surface text-destructive',
        )}
        role={isError ? 'alert' : 'status'}
      >
        <button
          type="button"
          class="absolute -top-2 -left-2 grid size-5 place-items-center rounded-full border border-foreground/20 bg-card"
          aria-label="Dismiss"
          onclick={() => dismissToast(item.id)}
        >
          <X class="size-3" />
        </button>
        {#if isError}
          <CircleAlert class="mt-0.5 size-4 shrink-0" />
        {:else}
          <Info class="mt-0.5 size-4 shrink-0" />
        {/if}
        <p class="text-sm">{item.text}</p>
        {#if item.action}
          {@const { label, run } = item.action}
          <button
            type="button"
            class="-my-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-brand outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring/60"
            onclick={() => {
              dismissToast(item.id);
              run();
            }}
          >
            {label}
          </button>
        {/if}
      </div>
    {/each}
  </div>
{/if}
