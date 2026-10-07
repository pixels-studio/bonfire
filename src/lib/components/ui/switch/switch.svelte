<script lang="ts">
  import { Switch as SwitchPrimitive } from 'bits-ui';
  import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    checked = $bindable(false),
    class: className,
    ...restProps
  }: WithoutChildrenOrChild<SwitchPrimitive.RootProps> = $props();
</script>

<SwitchPrimitive.Root
  bind:ref
  bind:checked
  data-slot="switch"
  class={cn(
    'group peer inline-flex h-5 w-8 shrink-0 items-center rounded-full p-0.5 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted motion-reduce:transition-none',
    className,
  )}
  {...restProps}
>
  <SwitchPrimitive.Thumb
    data-slot="switch-thumb"
    class="pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm data-[state=checked]:bg-primary-foreground transition-[width,translate] duration-200 ease-out group-active:w-5 data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0 group-active:data-[state=checked]:translate-x-2 motion-reduce:transition-none"
  />
</SwitchPrimitive.Root>
