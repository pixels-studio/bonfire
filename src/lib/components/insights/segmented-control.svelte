<script lang="ts">
  import { Tabs } from 'bits-ui';
  import { cn } from '$lib/utils';

  let {
    items,
    value = $bindable(),
    variant = 'pill',
    class: className,
    ...restProps
  }: {
    items: { value: string; label: string }[];
    value: string;
    /** `pill` is a container with a sliding pill; `text` is bare labels, the active one brighter. */
    variant?: 'pill' | 'text';
    class?: string;
    'aria-label'?: string;
  } = $props();

  const index = $derived(items.findIndex((item) => item.value === value));
</script>

<Tabs.Root bind:value class="shrink-0">
  {#if variant === 'text'}
    <Tabs.List class={cn('flex gap-6', className)} {...restProps}>
      {#each items as item (item.value)}
        <Tabs.Trigger
          value={item.value}
          class="rounded-sm text-muted-foreground outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=active]:text-foreground"
        >
          {item.label}
        </Tabs.Trigger>
      {/each}
    </Tabs.List>
  {:else}
    <Tabs.List
      class={cn(
        'relative inline-grid auto-cols-fr grid-flow-col rounded-full bg-secondary p-0.5',
        className,
      )}
      {...restProps}
    >
      <!-- One pill that slides to the active item; the items are equal width, so it moves in whole steps. -->
      <span
        aria-hidden="true"
        class="absolute inset-y-0.5 left-0.5 rounded-full bg-muted transition-transform duration-200 ease-out motion-reduce:transition-none"
        style:width={`calc((100% - 4px) / ${items.length})`}
        style:transform={`translateX(${index * 100}%)`}
      ></span>
      {#each items as item (item.value)}
        <Tabs.Trigger
          value={item.value}
          class="relative rounded-full px-3 py-1 text-muted-foreground outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=active]:text-foreground"
        >
          {item.label}
        </Tabs.Trigger>
      {/each}
    </Tabs.List>
  {/if}
</Tabs.Root>
