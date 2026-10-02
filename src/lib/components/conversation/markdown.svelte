<script lang="ts">
  import DOMPurify from 'dompurify';
  import { marked } from 'marked';
  import { cn } from '$lib/utils';

  let { text, class: className }: { text: string; class?: string } = $props();

  // Rendered HTML by block source. While text streams in only the last block changes,
  // so earlier blocks keep their DOM, which also keeps a selection or open code block steady.
  const rendered = new Map<string, string>();

  // Model output is untrusted, so the rendered HTML is sanitized before insertion.
  // Blocks are parsed on their own, so a link reference defined in a later block isn't seen.
  const blocks = $derived.by(() => {
    const sources = marked.lexer(text, { gfm: true }).map((token) => token.raw);
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

<div
  class={cn('prose prose-sm max-w-none prose-bonfire wrap-anywhere', className)}
>
  {#each blocks as html, index (index)}{@html html}{/each}
</div>
