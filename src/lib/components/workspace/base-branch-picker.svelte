<script lang="ts">
  import * as Select from '$lib/components/ui/select';
  import { errorMessage } from '$shared/domain';

  let {
    projectId,
    value = $bindable(),
    ...controlProps
  }: {
    projectId: string;
    value: string;
    'aria-labelledby'?: string;
  } = $props();

  let branches = $state<string[]>([]);
  let error = $state('');

  /** The chosen branch stays listed even when it isn't a named branch, like a detached HEAD. */
  const items = $derived(
    [...new Set([...(value ? [value] : []), ...branches])].map((branch) => ({
      value: branch,
      label: branch,
    })),
  );

  $effect(() => {
    const id = projectId;
    error = '';
    window.bonfire.git
      .branches(id)
      .then((listed) => {
        if (id === projectId) branches = listed;
      })
      .catch((cause) => {
        if (id === projectId) error = errorMessage(cause);
      });
  });
</script>

<Select.Root type="single" {items} bind:value>
  <Select.Trigger class="w-full" {...controlProps}>
    <Select.Value placeholder="Select a branch" />
  </Select.Trigger>
  <Select.Content class="max-h-64">
    {#each items as item (item.value)}
      <Select.Item value={item.value} label={item.label} />
    {/each}
    {#if error}
      <p class="px-1.5 py-1.5 text-destructive">{error}</p>
    {/if}
  </Select.Content>
</Select.Root>
