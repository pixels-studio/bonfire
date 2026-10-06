<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as Tooltip from '$lib/components/ui/tooltip';

  let {
    text,
    children,
  }: {
    /** What the tooltip says; empty shows none. */
    text: string;
    children: Snippet;
  } = $props();
</script>

{#if text}
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <!-- A wrapper, as a disabled button gets no pointer events and so couldn't explain why. -->
        <span {...props} class="inline-flex">
          {@render children()}
        </span>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="bottom">{text}</Tooltip.Content>
  </Tooltip.Root>
{:else}
  {@render children()}
{/if}
