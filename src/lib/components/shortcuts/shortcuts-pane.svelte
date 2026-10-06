<script lang="ts">
  import { overlayScrollbar } from '$lib/scrollbar';
  import { onMount } from 'svelte';
  import Search from '@lucide/svelte/icons/search';
  import * as Card from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import PaneHeader from '$lib/components/pane-header/pane-header.svelte';
  import type { PanelProps } from '$lib/panes';
  import {
    SHORTCUTS,
    SHORTCUT_GROUPS,
    shortcutKeys,
    type ShortcutId,
  } from '$lib/shortcuts';
  import { isMac } from '$lib/utils';
  import ShortcutKeys from './shortcut-keys.svelte';

  let { onclose }: PanelProps = $props();

  let query = $state('');
  let search = $state<HTMLInputElement | null>(null);

  const ids = Object.keys(SHORTCUTS) as ShortcutId[];

  /** Whether a shortcut matches every word typed, in its name, group or keys. */
  function matches(id: ShortcutId, words: string[]) {
    const { label, group } = SHORTCUTS[id];
    const text = [label, group, ...shortcutKeys(id, isMac()).flat()]
      .join(' ')
      .toLowerCase();
    return words.every((word) => text.includes(word));
  }

  const groups = $derived.by(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return SHORTCUT_GROUPS.map((group) => ({
      group,
      ids: ids.filter(
        (id) => SHORTCUTS[id].group === group && matches(id, words),
      ),
    })).filter(({ ids }) => ids.length);
  });

  onMount(() => search?.focus({ preventScroll: true }));
</script>

<Card.Root
  class="h-full min-w-0 gap-0"
  role="region"
  aria-label="Keyboard shortcuts"
>
  <PaneHeader title="Keyboard shortcuts" icon="keyboard" {onclose} />
  <div class="shrink-0 px-4 pb-4">
    <div class="relative">
      <Search
        class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        bind:ref={search}
        type="search"
        placeholder="Search shortcuts…"
        aria-label="Search shortcuts"
        autocomplete="off"
        spellcheck="false"
        class="rounded-lg border-transparent bg-composer pl-8 focus-visible:border-transparent dark:bg-composer [&::-webkit-search-cancel-button]:appearance-none"
        bind:value={query}
        onkeydown={(event) => {
          if (event.key === 'Escape') query = '';
        }}
      />
    </div>
  </div>
  <div
    {@attach overlayScrollbar}
    class="min-h-0 flex-1 overflow-y-auto px-4 pb-6"
  >
    {#each groups as { group, ids } (group)}
      <section class="not-first:mt-12" aria-label={group}>
        <h3 class="mb-1 text-sm text-muted-foreground">{group}</h3>
        <ul>
          {#each ids as id (id)}
            <li
              class="flex min-h-10 items-center justify-between gap-4 py-1 text-sm"
            >
              <span>{SHORTCUTS[id].label}</span>
              <ShortcutKeys {id} all class="shrink-0" />
            </li>
          {/each}
        </ul>
      </section>
    {:else}
      <p class="py-8 text-center text-sm text-muted-foreground">
        No shortcuts match “{query.trim()}”.
      </p>
    {/each}
  </div>
</Card.Root>
