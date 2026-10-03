<script lang="ts">
  import { shortcutKeys, type ShortcutId } from '$lib/shortcuts';
  import { cn, isMac } from '$lib/utils';

  let {
    id,
    all = false,
    inverse = false,
    class: className,
  }: {
    id: ShortcutId;
    /** Shows the alternative chords too, joined by "or"; otherwise only the primary one. */
    all?: boolean;
    /** For light-on-dark surfaces such as tooltips. */
    inverse?: boolean;
    class?: string;
  } = $props();

  const chords = $derived(
    all ? shortcutKeys(id, isMac()) : shortcutKeys(id, isMac()).slice(0, 1),
  );
</script>

<span
  class={cn(
    'inline-flex items-center gap-1.5 text-xs text-muted-foreground',
    inverse && 'text-background/70',
    className,
  )}
>
  {#each chords as keys, index (index)}
    {#if index > 0}<span>or</span>{/if}
    <span>{keys.join(isMac() ? '' : '+')}</span>
  {/each}
</span>
