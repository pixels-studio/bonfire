<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import Icon from '$lib/components/icon/icon.svelte';
  import { limits } from '$lib/stores/limits.svelte';
  import SegmentedControl from './segmented-control.svelte';
  import TokensTab from './tokens-tab.svelte';
  import UsageTab from './usage-tab.svelte';

  const TABS = [
    { value: 'usage', label: 'Usage' },
    { value: 'tokens', label: 'Tokens' },
  ];

  let { class: className }: { class?: string } = $props();
  let tab = $state(TABS[0].value);
</script>

<Popover.Root onOpenChange={(open) => open && limits.refresh()}>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="secondary"
        size="icon"
        class={className}
        aria-label="Insights"
      >
        <Icon name="insights" />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content
    align="end"
    sideOffset={8}
    collisionPadding={8}
    class="max-h-[calc(100vh-80px)] w-[400px] gap-0 overflow-hidden p-0"
  >
    <div
      class="flex shrink-0 items-center justify-between border-b border-border px-4 py-3"
    >
      <h2 class="flex items-center gap-2 font-medium">
        <Icon name="insights" class="text-muted-foreground" />
        Insights
      </h2>
      <SegmentedControl items={TABS} bind:value={tab} aria-label="Insights" />
    </div>
    <div class="min-h-0 overflow-y-auto">
      {#if tab === 'usage'}
        <UsageTab />
      {:else}
        <TokensTab />
      {/if}
    </div>
  </Popover.Content>
</Popover.Root>
