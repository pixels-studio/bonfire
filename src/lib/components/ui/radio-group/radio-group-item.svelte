<script lang="ts">
  import { RadioGroup as RadioGroupPrimitive } from 'bits-ui';
  import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChildrenOrChild<RadioGroupPrimitive.ItemProps> = $props();
</script>

<RadioGroupPrimitive.Item
  bind:ref
  data-slot="radio-group-item"
  class={cn(
    'group/radio flex size-4 shrink-0 items-center justify-center rounded-full border border-input outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:border-primary data-[state=checked]:bg-primary motion-reduce:transition-none',
    className,
  )}
  {...restProps}
>
  <span
    class="size-1.5 rounded-full bg-primary-foreground opacity-0 group-data-[state=checked]/radio:opacity-100"
  ></span>
</RadioGroupPrimitive.Item>
