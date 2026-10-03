<script lang="ts">
  import ShieldAlert from '@lucide/svelte/icons/shield-alert';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import * as Select from '$lib/components/ui/select';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { APPROVAL_MODES } from '$lib/models';
  import type { ApprovalMode } from '$shared/contracts';

  let { value = $bindable() }: { value: ApprovalMode } = $props();

  const label = $derived(
    APPROVAL_MODES.find((mode) => mode.value === value)?.label,
  );
</script>

<Select.Root
  type="single"
  items={APPROVAL_MODES}
  bind:value={() => value, (next) => (value = next as ApprovalMode)}
>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props: tooltipProps })}
        <Select.Trigger
          {...tooltipProps}
          aria-label={`Permissions: ${label}`}
          class="gap-1 border-0 bg-transparent px-0 dark:bg-transparent dark:hover:bg-transparent"
        >
          {#if value === 'ask'}
            <ShieldCheck class="text-muted-foreground" />
          {:else}
            <ShieldAlert class="text-muted-foreground" />
          {/if}
        </Select.Trigger>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content>{label}</Tooltip.Content>
  </Tooltip.Root>
  <Select.Content>
    {#each APPROVAL_MODES as mode (mode.value)}
      <Select.Item value={mode.value} label={mode.label} />
    {/each}
  </Select.Content>
</Select.Root>
