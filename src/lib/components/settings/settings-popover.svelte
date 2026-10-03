<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import Icon from '$lib/components/icon/icon.svelte';
  import SettingsPanel from './settings-panel.svelte';

  let { class: className }: { class?: string } = $props();
  let content = $state<HTMLElement | null>(null);

  /**
   * Focuses the panel rather than its first control, an info icon whose tooltip would
   * otherwise open on its own. Tab still moves into the settings from here.
   */
  function focusPanel(event: Event) {
    event.preventDefault();
    content?.focus();
  }
</script>

<Popover.Root>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="secondary"
        size="icon"
        class={className}
        aria-label="Settings"
      >
        <Icon name="settings" />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content
    bind:ref={content}
    tabindex={-1}
    onOpenAutoFocus={focusPanel}
    align="end"
    sideOffset={8}
    collisionPadding={8}
    class="max-h-[calc(100vh-160px)] w-100 gap-0 overflow-hidden p-0"
  >
    <div class="flex shrink-0 items-center border-b border-border px-6 py-3">
      <h2 class="flex items-center gap-2 font-medium">
        <Icon name="settings" class="text-muted-foreground" />
        Settings
      </h2>
    </div>
    <div class="min-h-0 overflow-y-auto">
      <SettingsPanel />
    </div>
  </Popover.Content>
</Popover.Root>
