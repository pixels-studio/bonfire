<script lang="ts">
  import * as Select from '$lib/components/ui/select';
  import { catalog } from '$lib/stores/models.svelte';
  import { preferences } from '$lib/stores/preferences.svelte';
  import type { ModelChoice } from '$shared/contracts';
  import { PROVIDER_LABELS } from '$shared/domain';
  import type { SettingControlProps } from './setting.svelte';

  /** Stands for "no fixed model" in the list, as a select can't hold `null`. */
  const LAST_USED = 'last-used';

  let {
    value,
    onchange,
    allowLastUsed = false,
    ...controlProps
  }: SettingControlProps & {
    value: ModelChoice | null;
    onchange: (value: ModelChoice | null) => void;
    /** Offers "Last used", which is chosen as `null`. */
    allowLastUsed?: boolean;
  } = $props();

  const items = $derived([
    ...(allowLastUsed ? [{ value: LAST_USED, label: 'Last used' }] : []),
    ...preferences.enabledProviders.flatMap((provider) =>
      catalog.for(provider),
    ),
  ]);

  function select(next: string) {
    if (next === LAST_USED) return onchange(null);
    const model = catalog.find(next);
    if (model) onchange({ provider: model.provider, model: model.value });
  }
</script>

<Select.Root
  type="single"
  {items}
  value={value?.model ?? LAST_USED}
  onValueChange={select}
>
  <Select.Trigger class="w-full" {...controlProps}>
    <Select.Value placeholder={value?.model} />
  </Select.Trigger>
  <Select.Content>
    {#if allowLastUsed}
      <Select.Item value={LAST_USED} label="Last used" />
    {/if}
    {#each preferences.enabledProviders as provider (provider)}
      <Select.Group>
        <Select.GroupHeading>{PROVIDER_LABELS[provider]}</Select.GroupHeading>
        {#each catalog.for(provider) as model (model.value)}
          <Select.Item value={model.value} label={model.label} />
        {/each}
      </Select.Group>
    {/each}
  </Select.Content>
</Select.Root>
