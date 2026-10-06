<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { prefersReducedMotion } from 'svelte/motion';

  let {
    label,
    onclose,
    children,
  }: {
    /** What the overlay is announced as. */
    label: string;
    onclose: () => void;
    children: Snippet;
  } = $props();

  const duration = $derived(prefersReducedMotion.current ? 0 : 160);

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    // A menu or dialog inside the panel closes first.
    if (document.querySelector('[role="menu"], [role="dialog"]')) return;
    event.preventDefault();
    onclose();
  }

  /** Puts the cursor in the panel, so the keyboard reaches it straight away. */
  function focusIn(node: HTMLElement) {
    if (!node.contains(document.activeElement)) node.focus();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Covers the workspace list and panes; a click on the blur around the panel closes it. -->
<div
  class="absolute inset-0 z-50 grid place-items-center bg-background/55 p-6 backdrop-blur-md"
  transition:fade={{ duration }}
  onpointerdown={(event) => {
    if (event.target === event.currentTarget) onclose();
  }}
  role="presentation"
>
  <section
    class="h-full max-h-[52rem] w-full max-w-4xl min-w-0 outline-none *:shadow-2xl *:shadow-black/40"
    aria-label={label}
    tabindex="-1"
    use:focusIn
    in:scale={{ start: 0.98, duration, easing: cubicOut }}
  >
    {@render children()}
  </section>
</div>
