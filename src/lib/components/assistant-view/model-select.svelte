<script lang="ts">
  import * as Select from '$lib/components/ui/select';
  import { MODELS, PROVIDERS, modelsFor } from '$lib/models';
  import { PROVIDER_LABELS } from '$shared/domain';

  let {
    value,
    onchange,
  }: { value: string; onchange: (value: string) => void } = $props();
</script>

<Select.Root type="single" items={MODELS} {value} onValueChange={onchange}>
  <Select.Trigger
    aria-label="Select model"
    class="border-0 bg-transparent px-0 dark:bg-transparent dark:hover:bg-transparent"
  >
    <Select.Value placeholder="Default" />
  </Select.Trigger>
  <Select.Content>
    {#each PROVIDERS as provider (provider)}
      <Select.Group>
        <Select.GroupHeading>{PROVIDER_LABELS[provider]}</Select.GroupHeading>
        {#each modelsFor(provider) as model (model.value)}
          <Select.Item value={model.value} label={model.label}
            >{model.label}</Select.Item
          >
        {/each}
      </Select.Group>
    {/each}
  </Select.Content>
</Select.Root>
