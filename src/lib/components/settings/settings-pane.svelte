<script lang="ts">
  import * as Card from '$lib/components/ui/card';
  import Icon from '$lib/components/icon/icon.svelte';
  import SettingsPanel from './settings-panel.svelte';
</script>

<Card.Root class="h-full min-w-0 gap-0">
  <header class="flex min-h-13.5 shrink-0 items-center px-4 py-3">
    <h2 class="flex items-center gap-2 text-sm font-semibold">
      <Icon name="settings" class="text-muted-foreground" />
      Settings
    </h2>
  </header>
  <div class="min-h-0 flex-1 overflow-y-auto">
    <SettingsPanel />
  </div>
</Card.Root>
