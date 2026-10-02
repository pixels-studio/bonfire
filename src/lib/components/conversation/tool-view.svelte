<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import type { ConversationMessage } from '$shared/contracts';

  let { message }: { message: ConversationMessage } = $props();
  const parts = $derived(message.text.split('\n'));
  const label = $derived(parts[0]);
  const rest = $derived(parts.slice(1));
</script>

<details class="tool">
  <summary><ChevronRight /> <span>{label || 'Tool call'}</span></summary>
  {#if rest.length}<pre>{rest.join('\n')}</pre>{/if}
</details>

<style>
  .tool {
    color: var(--foreground-subtle);
    font-size: 12px;
  }
  summary {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  :global(svg) {
    width: 14px;
    height: 14px;
    transition: transform 150ms ease;
  }
  details[open] :global(svg) {
    transform: rotate(90deg);
  }
  pre {
    max-height: 180px;
    margin: 8px 0 0 20px;
    overflow: auto;
    color: var(--foreground-muted);
  }
  @media (prefers-reduced-motion: reduce) {
    :global(svg) {
      transition-property: color;
    }
  }
</style>
