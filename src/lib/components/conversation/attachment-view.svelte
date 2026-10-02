<script lang="ts">
  import Icon from '$lib/components/icon/icon.svelte';

  let {
    name,
    size,
    previewUrl,
  }: { name: string; size?: number; previewUrl?: string } = $props();

  function formatSize(bytes?: number) {
    if (bytes === undefined) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

<div class="attachment">
  {#if previewUrl}
    <img class="thumb" src={previewUrl} alt="" />
  {:else}
    <Icon name="file" />
  {/if}
  <span><strong>{name}</strong><small>{formatSize(size)}</small></span>
</div>

<style>
  .attachment {
    display: flex;
    align-self: flex-end;
    align-items: center;
    width: fit-content;
    max-width: min(400px, 88%);
    gap: 10px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--surface-raised);
    color: var(--foreground);
  }
  .thumb {
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: 6px;
    object-fit: cover;
  }
  :global(svg) {
    width: 18px;
    height: 18px;
  }
  span {
    display: grid;
    min-width: 0;
  }
  strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  small {
    color: var(--foreground-subtle);
  }
</style>
