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
    'group/radio flex size-4 shrink-0 items-center justify-center rounded-full border border-input outline-none transition-[background-color,border-color,transform] duration-150 active:scale-90 focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:border-brand data-[state=checked]:bg-brand motion-reduce:transition-none',
    className,
  )}
  {...restProps}
>
  <span
    class="size-1.5 scale-0 rounded-full bg-white opacity-0 transition-[transform,opacity] duration-250 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-data-[state=checked]/radio:scale-100 group-data-[state=checked]/radio:opacity-100 motion-reduce:transition-none"
  ></span>
</RadioGroupPrimitive.Item>
