<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Icon from '$lib/components/icon/icon.svelte';
  import { cn } from '$lib/utils';

  let {
    label,
    signingIn,
    disabled = false,
    onclick,
    oncancel,
  }: {
    /** What the button does, such as "Switch Claude account". */
    label: string;
    /** While a browser sign-in is open, the button spins and cancels it. */
    signingIn: boolean;
    disabled?: boolean;
    onclick: () => void;
    oncancel?: () => void;
  } = $props();

  const action = $derived(signingIn ? 'Cancel sign-in' : label);
</script>

<Tooltip.Root>
  <Tooltip.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="ghost"
        size="icon-xs"
        class="size-5 text-muted-foreground hover:text-foreground"
        aria-label={action}
        disabled={disabled || (signingIn && !oncancel)}
        onclick={signingIn ? oncancel : onclick}
      >
        <Icon
          name="switch-account"
          class={cn(
            'size-4',
            signingIn && 'animate-spin motion-reduce:animate-none',
          )}
        />
      </Button>
    {/snippet}
  </Tooltip.Trigger>
  <Tooltip.Content>{action}</Tooltip.Content>
</Tooltip.Root>
