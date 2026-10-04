<script lang="ts">
  import { overlayScrollbar } from '$lib/scrollbar';
  import { parseDiff } from '$lib/diff';
  import { highlight, type Token } from '$lib/highlight';
  import { cn } from '$lib/utils';

  let { diff, path }: { diff: string; path: string } = $props();

  const rows = $derived.by(() => {
    let index = 0;
    return parseDiff(diff).map((row) =>
      row.kind === 'hunk' ? row : { ...row, index: index++ },
    );
  });
  const source = $derived(
    rows.flatMap((row) => (row.kind === 'hunk' ? [] : [row.text])),
  );

  let highlighted = $state<{ source: string; tokens: Token[][] }>({
    source: '',
    tokens: [],
  });
  // Tokens from an earlier version of the file are never shown against newer lines.
  const tokens = $derived(
    highlighted.source === source.join('\n') ? highlighted.tokens : [],
  );

  $effect(() => {
    const lines = source;
    let stale = false;
    highlight(lines, path)
      .then((result) => {
        if (!stale) highlighted = { source: lines.join('\n'), tokens: result };
      })
      .catch(() => {});
    return () => (stale = true);
  });

  function lineTokens(row: { index: number; text: string }): Token[] {
    return tokens[row.index] ?? (row.text ? [{ content: row.text }] : []);
  }

  const GUTTER = {
    add: 'text-success',
    delete: 'text-destructive',
    context: 'text-muted-foreground',
  };
</script>

<div
  {@attach overlayScrollbar}
  class="mb-2 overflow-x-auto rounded-lg border border-border bg-black/25 py-2 font-mono text-xs/relaxed"
>
  {#if rows.length}
    <div class="min-w-max">
      {#each rows as row, position (position)}
        {#if row.kind === 'hunk'}
          <div
            class="px-3 py-1 whitespace-pre text-muted-foreground {position
              ? 'mt-2'
              : ''} bg-secondary"
          >
            {row.text}
          </div>
        {:else}
          <div
            class={cn(
              'flex whitespace-pre',
              row.kind === 'add' && 'bg-success/10',
              row.kind === 'delete' && 'bg-destructive/10',
            )}
          >
            <span
              class={cn(
                'w-12 shrink-0 pr-3 text-right select-none',
                GUTTER[row.kind],
              )}>{row.line}</span
            >
            <span class="pr-4"
              >{#each lineTokens(row) as token}<span style:color={token.color}
                  >{token.content}</span
                >{:else}{' '}{/each}</span
            >
          </div>
        {/if}
      {/each}
    </div>
  {:else}
    <p class="px-3 text-muted-foreground">No textual changes to show.</p>
  {/if}
</div>
