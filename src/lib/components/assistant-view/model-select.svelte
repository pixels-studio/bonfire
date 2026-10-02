<script lang="ts">
  import * as Select from '$lib/components/ui/select';
  import { PROVIDERS } from '$lib/models';
  import { catalog } from '$lib/stores/models.svelte';
  import { PROVIDER_LABELS } from '$shared/domain';

  let {
    value,
    onchange,
  }: { value: string; onchange: (value: string) => void } = $props();
</script>

<Select.Root type="single" items={catalog.all} {value} onValueChange={onchange}>
  <Select.Trigger
    aria-label="Select model"
    class="gap-2 border-0 bg-transparent px-0 dark:bg-transparent dark:hover:bg-transparent"
  >
    <Select.Value placeholder="Default" />
  </Select.Trigger>
  <Select.Content>
    {#each PROVIDERS as provider (provider)}
      <Select.Group>
        <Select.GroupHeading>{PROVIDER_LABELS[provider]}</Select.GroupHeading>
        {#each catalog.for(provider) as model (model.value)}
          <Select.Item value={model.value} label={model.label}
            >{model.label}</Select.Item
          >
        {/each}
      </Select.Group>
    {/each}
  </Select.Content>
</Select.Root>
