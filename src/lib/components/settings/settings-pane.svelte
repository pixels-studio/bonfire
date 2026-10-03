<script lang="ts">
  import * as Card from '$lib/components/ui/card';
  import SettingsPanel from './settings-panel.svelte';
</script>

<Card.Root class="h-full min-w-0 gap-0" role="region" aria-label="Settings">
  <div class="min-h-0 flex-1 overflow-y-auto">
    <SettingsPanel />
  </div>
</Card.Root>
