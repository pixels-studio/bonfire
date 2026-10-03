<script lang="ts" generics="Value extends string">
  import * as Select from '$lib/components/ui/select';
  import type { SettingControlProps } from './setting.svelte';

  type Option = { value: Value; label: string };

  let {
    value,
    options,
    onchange,
    disabled = false,
    ...controlProps
  }: SettingControlProps & {
    value: Value;
    options: Option[];
    onchange: (value: Value) => void;
    disabled?: boolean;
  } = $props();
</script>

<Select.Root
  type="single"
  items={options}
  {value}
  {disabled}
  onValueChange={(next) => onchange(next as Value)}
>
  <Select.Trigger class="w-full" {...controlProps}>
    <Select.Value />
  </Select.Trigger>
  <Select.Content>
    {#each options as option (option.value)}
      <Select.Item value={option.value} label={option.label} />
    {/each}
  </Select.Content>
</Select.Root>
