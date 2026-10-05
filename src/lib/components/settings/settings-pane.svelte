<script lang="ts">
  import { overlayScrollbar } from '$lib/scrollbar';
  import * as Card from '$lib/components/ui/card';
  import PaneHeader from '$lib/components/pane-header/pane-header.svelte';
  import type { PanelProps } from '$lib/panes';
  import SettingsPanel from './settings-panel.svelte';

  let { dragHandle, size, onresize, onclose }: PanelProps = $props();
</script>

<Card.Root class="h-full min-w-0 gap-0" role="region" aria-label="Settings">
  <PaneHeader
    title="Settings"
    icon="settings"
    {dragHandle}
    {size}
    {onresize}
    {onclose}
    resizable={false}
  />
  <div
    {@attach overlayScrollbar}
    class="min-h-0 flex-1 overflow-y-auto overscroll-contain"
  >
    <SettingsPanel />
  </div>
</Card.Root>
