<script lang="ts">
  import DOMPurify from 'dompurify';
  import { marked } from 'marked';
  import { MarkdownBlocks } from '$lib/markdown-blocks';
  import { lightbox, rectOf } from '$lib/stores/lightbox.svelte';
  import { cn } from '$lib/utils';

  let { text, class: className }: { text: string; class?: string } = $props();

  /** A click on an embedded image opens it fullscreen, rather than following any link around it. */
  function onclick(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) return;
    event.preventDefault();
    lightbox.show({
      src: target.currentSrc || target.src,
      alt: target.alt,
      origin: rectOf(target),
    });
  }

  // Rendered HTML by block source. While text streams in only the last block changes,
  // so earlier blocks keep their DOM, which also keeps a selection or open code block steady.
  const rendered = new Map<string, string>();
  const splitter = new MarkdownBlocks();

  // Model output is untrusted, so the rendered HTML is sanitized before insertion.
  // Blocks are parsed on their own, so a link reference defined in a later block isn't seen.
  const blocks = $derived.by(() => {
    const sources = splitter.update(text);
    const html = sources.map((source) => {
      let block = rendered.get(source);
      if (block === undefined) {
        block = DOMPurify.sanitize(
          marked.parse(source, { async: false, gfm: true }),
        );
        rendered.set(source, block);
      }
      return block;
    });
    // Drops what the text no longer contains, such as the half-written blocks passed on the way.
    const current = new Set(sources);
    for (const source of rendered.keys())
      if (!current.has(source)) rendered.delete(source);
    return html;
  });
</script>

<!-- Delegates clicks to any embedded image, which is the only interactive content here. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class={cn('prose prose-sm max-w-none prose-bonfire wrap-anywhere', className)}
  {onclick}
>
  {#each blocks as html, index (index)}{@html html}{/each}
</div>

<style>
  /* Images aren't in the Svelte tree (they arrive through {@html}), so this reaches them with
     :global rather than the usual compiler-scoped selector. */
  div :global(img) {
    display: block;
    max-width: 100%;
    max-height: 24rem;
    border-radius: 0.75rem;
    border: 1px solid var(--color-border);
    cursor: zoom-in;
  }
</style>
