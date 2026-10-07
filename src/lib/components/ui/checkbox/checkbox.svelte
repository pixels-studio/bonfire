<script lang="ts">
  import { Checkbox as CheckboxPrimitive } from 'bits-ui';
  import Check from '@lucide/svelte/icons/check';
  import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    checked = $bindable(false),
    class: className,
    ...restProps
  }: WithoutChildrenOrChild<CheckboxPrimitive.RootProps> = $props();
</script>

<CheckboxPrimitive.Root
  bind:ref
  bind:checked
  data-slot="checkbox"
  class={cn(
    'peer flex size-4 shrink-0 items-center justify-center rounded-[5px] border border-input text-primary-foreground outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:border-primary data-[state=checked]:bg-primary motion-reduce:transition-none',
    className,
  )}
  {...restProps}
>
  {#snippet children({ checked })}
    {#if checked}
      <Check class="size-3" strokeWidth={3} />
    {/if}
  {/snippet}
</CheckboxPrimitive.Root>
