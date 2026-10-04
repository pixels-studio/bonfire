<script lang="ts">
  import * as Card from '$lib/components/ui/card';
  import PaneHeader from '$lib/components/pane-header/pane-header.svelte';
  import type { PanelProps } from '$lib/panes';
  import SettingsPanel from './settings-panel.svelte';

  let { dragHandle, onresize, onclose }: PanelProps = $props();
</script>

<Card.Root class="h-full min-w-0 gap-0" role="region" aria-label="Settings">
  <PaneHeader
    title="Settings"
    icon="settings"
    {dragHandle}
    {onresize}
    {onclose}
  />
  <div class="min-h-0 flex-1 overflow-y-auto">
    <SettingsPanel />
  </div>
</Card.Root>
