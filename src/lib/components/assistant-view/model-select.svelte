<script lang="ts">
  import * as Select from '$lib/components/ui/select';
  import { catalog } from '$lib/stores/models.svelte';
  import type { AssistantProvider } from '$shared/contracts';

  let {
    provider,
    value,
    onchange,
  }: {
    /** Whose models to offer. */
    provider: AssistantProvider;
    value: string;
    onchange: (value: string) => void;
  } = $props();

  const items = $derived(catalog.for(provider));
</script>

<Select.Root type="single" {items} {value} onValueChange={onchange}>
  <Select.Trigger
    aria-label="Select model"
    class="gap-2 border-0 bg-transparent px-0 dark:bg-transparent dark:hover:bg-transparent"
  >
    <Select.Value placeholder="Default" />
  </Select.Trigger>
  <Select.Content>
    {#each items as model (model.value)}
      <Select.Item value={model.value} label={model.label}
        >{model.label}</Select.Item
      >
    {/each}
  </Select.Content>
</Select.Root>
