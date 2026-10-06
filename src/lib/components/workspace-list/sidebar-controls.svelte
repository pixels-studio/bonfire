<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Icon from '$lib/components/icon/icon.svelte';

  let {
    collapsed = false,
    canSwitch = false,
    ontoggle,
    onprevious,
    onnext,
  }: {
    /** Whether the sidebar is hidden, so the button offers to show it. */
    collapsed?: boolean;
    /** Whether there is another project to go to. */
    canSwitch?: boolean;
    ontoggle: () => void;
    onprevious: () => void;
    onnext: () => void;
  } = $props();

  const BUTTON_CLASS =
    'size-7 text-muted-foreground app-no-drag hover:text-foreground';
</script>

{#snippet control(
  label: string,
  icon: string,
  onclick: () => void,
  disabled = false,
)}
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost"
          size="icon-sm"
          class={BUTTON_CLASS}
          aria-label={label}
          {disabled}
          {onclick}
        >
          <Icon name={icon} />
        </Button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="bottom">{label}</Tooltip.Content>
  </Tooltip.Root>
{/snippet}

{@render control(
  collapsed ? 'Show sidebar' : 'Hide sidebar',
  'sidebar',
  ontoggle,
)}
<span class="flex-1"></span>
{@render control('Previous project', 'arrow-left', onprevious, !canSwitch)}
{@render control('Next project', 'arrow-right', onnext, !canSwitch)}
