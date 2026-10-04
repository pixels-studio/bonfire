<script lang="ts">
  import type { Terminal } from '@xterm/xterm';

  /**
   * A macOS-style overlay scroller for a terminal, at the pane's edge. It shows while the
   * user scrolls and fades out a moment after; hovering it holds it and widens the thumb,
   * as AppKit's does. Output streaming in doesn't flash it.
   */
  let {
    term,
    surface,
  }: {
    term: Terminal | undefined;
    /** The element whose wheel scrolling reveals the scroller. */
    surface: HTMLElement | undefined;
  } = $props();

  /** How long the scroller stays after the last scroll, as on macOS. */
  const LINGER_MS = 1000;
  const MIN_THUMB = 24;
  const INSET = 2;

  let track = $state<HTMLDivElement>();
  let trackHeight = $state(0);
  let viewportY = $state(0);
  let baseY = $state(0);
  let rows = $state(1);
  let shown = $state(false);
  let hovered = $state(false);
  let dragging = $state(false);
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const scrollable = $derived(baseY > 0);
  const thumbHeight = $derived(
    Math.min(
      trackHeight,
      Math.max(MIN_THUMB, (trackHeight * rows) / (baseY + rows)),
    ),
  );
  const thumbTop = $derived(
    baseY ? (viewportY / baseY) * (trackHeight - thumbHeight) : 0,
  );
  const visible = $derived(scrollable && (shown || hovered || dragging));
  const expanded = $derived(hovered || dragging);

  function read() {
    if (!term) return;
    const buffer = term.buffer.active;
    viewportY = buffer.viewportY;
    baseY = buffer.baseY;
    rows = term.rows;
  }

  /** Shows the scroller, and fades it once scrolling has stopped for a moment. */
  function reveal() {
    shown = true;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => (shown = false), LINGER_MS);
  }

  $effect(() => {
    const terminal = term;
    if (!terminal) return;
    read();
    const atBottom = () =>
      terminal.buffer.active.viewportY === terminal.buffer.active.baseY;
    let wasAtBottom = atBottom();
    const subscriptions = [
      terminal.onScroll(() => {
        // Output pushing a followed terminal along scrolls it too; only a move the
        // user made, away from or back to the bottom, shows the scroller.
        const bottom = atBottom();
        if (!bottom || !wasAtBottom) reveal();
        wasAtBottom = bottom;
        read();
      }),
      terminal.onWriteParsed(read),
      terminal.onResize(read),
    ];
    return () =>
      subscriptions.forEach((subscription) => subscription.dispose());
  });

  $effect(() => {
    const element = surface;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY) reveal();
    };
    element.addEventListener('wheel', onWheel, { passive: true });
    return () => element.removeEventListener('wheel', onWheel);
  });

  $effect(() => {
    if (!track) return;
    const observer = new ResizeObserver(() => {
      trackHeight = (track?.clientHeight ?? 0) - INSET * 2;
    });
    observer.observe(track);
    return () => observer.disconnect();
  });

  $effect(() => () => clearTimeout(hideTimer));

  /** Wheel over the scroller scrolls the terminal, as it would over the text. */
  let wheelRemainder = 0;
  function onTrackWheel(event: WheelEvent) {
    if (!term) return;
    event.preventDefault();
    const lineHeight =
      (track?.clientHeight ?? 0) / Math.max(term.rows, 1) || 16;
    const pixels =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? event.deltaY * lineHeight
        : event.deltaY;
    wheelRemainder += pixels / lineHeight;
    const lines = Math.trunc(wheelRemainder);
    wheelRemainder -= lines;
    if (lines) term.scrollLines(lines);
    reveal();
  }

  /** Clicking the track pages toward the click, as macOS does by default. */
  function onTrackDown(event: PointerEvent) {
    if (!term || !track || event.button !== 0 || event.target !== track) return;
    const y = event.clientY - track.getBoundingClientRect().top - INSET;
    term.scrollPages(y < thumbTop ? -1 : 1);
  }

  function onThumbDown(event: PointerEvent) {
    if (!term || event.button !== 0) return;
    event.preventDefault();
    const thumb = event.currentTarget as HTMLElement;
    thumb.setPointerCapture(event.pointerId);
    dragging = true;
    const startY = event.clientY;
    const startLine = viewportY;
    const span = Math.max(trackHeight - thumbHeight, 1);
    const move = (moved: PointerEvent) => {
      const line = Math.round(
        startLine + ((moved.clientY - startY) * baseY) / span,
      );
      term?.scrollToLine(Math.min(Math.max(line, 0), baseY));
    };
    const end = () => {
      dragging = false;
      reveal();
      thumb.removeEventListener('pointermove', move);
      thumb.removeEventListener('pointerup', end);
      thumb.removeEventListener('pointercancel', end);
    };
    thumb.addEventListener('pointermove', move);
    thumb.addEventListener('pointerup', end);
    thumb.addEventListener('pointercancel', end);
  }
</script>

{#if scrollable}
  <!-- Mouse-only, like the system scroller; the keyboard scrolls the terminal itself. -->
  <div
    bind:this={track}
    class={[
      'absolute inset-y-0 right-0 z-10 w-3.5 border-l transition-[opacity,background-color,border-color] duration-200',
      expanded ? 'border-white/5 bg-white/[0.03]' : 'border-transparent',
      visible ? 'opacity-100' : 'opacity-0 duration-500',
    ]}
    aria-hidden="true"
    onpointerenter={() => (hovered = true)}
    onpointerleave={() => (hovered = false)}
    onpointerdown={onTrackDown}
    onwheel={onTrackWheel}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class={[
        'absolute right-0.5 rounded-full transition-[width,background-color] duration-150',
        expanded ? 'w-2 bg-white/35' : 'w-[5px] bg-white/20',
      ]}
      style:top="{INSET + thumbTop}px"
      style:height="{thumbHeight}px"
      onpointerdown={onThumbDown}
    ></div>
  </div>
{/if}
