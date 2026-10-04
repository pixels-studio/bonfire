/**
 * An overlay scroller for any scrolling element, used as `{@attach overlayScrollbar}`.
 *
 * It replaces the native scrollbar, which on Windows and Linux takes up a gutter and is drawn in
 * the system's style, with the macOS-style one the terminal already uses (`terminal-scrollbar`):
 * a thin thumb over the content's edge that shows while the user scrolls and fades out a moment
 * after. Hovering the edge reveals it, hovering the thumb widens it, and it can be dragged or
 * clicked to page. Scrolling the code does itself, such as following a streaming reply, doesn't
 * flash it.
 *
 * The rails go next to the element rather than inside it, so they neither scroll with its content
 * nor disturb its children or the markup Svelte manages there. CSS anchor positioning pins them to
 * the element's edges; their styles are in `app.css` under `[data-scrollbar]`.
 */

type Axis = 'y' | 'x';

/** How long the scroller stays after the last scroll, as on macOS. */
const LINGER_MS = 1000;
/** A key press scrolls a moment later; a scroll that soon after one is the user's. */
const KEY_INTENT_MS = 500;
const MIN_THUMB = 24;
/** The thumb's gap from the ends of its rail. */
const INSET = 2;
/** How close to the edge the pointer must come to reveal the scroller; the rail's width. */
const EDGE = 14;

const SCROLL_KEYS: Record<string, Axis> = {
  ArrowUp: 'y',
  ArrowDown: 'y',
  PageUp: 'y',
  PageDown: 'y',
  Home: 'y',
  End: 'y',
  ' ': 'y',
  ArrowLeft: 'x',
  ArrowRight: 'x',
};

let count = 0;

function isEditable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement)
  );
}

export function overlayScrollbar(node: HTMLElement) {
  const parent = node.parentElement;
  if (!parent) return;

  const anchor = `--scrollbar-${++count}`;
  const previousWidth = node.style.scrollbarWidth;
  node.style.scrollbarWidth = 'none';
  node.style.setProperty('anchor-name', anchor);

  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let keyAt = 0;
  let keyAxis: Axis = 'y';

  const rails = (['y', 'x'] as const).map((axis) => createRail(axis));

  function createRail(axis: Axis) {
    const rail = document.createElement('div');
    rail.dataset.scrollbar = axis;
    rail.setAttribute('aria-hidden', 'true');
    rail.style.setProperty('position-anchor', anchor);
    const thumb = document.createElement('div');
    rail.append(thumb);
    // After the element (and after the other rail), so it paints above the content.
    (axis === 'y' ? node : node.nextElementSibling!).after(rail);

    const state = {
      shown: false,
      hovered: false,
      dragging: false,
      size: 0,
      offset: 0,
    };

    const client = () => (axis === 'y' ? node.clientHeight : node.clientWidth);
    const total = () => (axis === 'y' ? node.scrollHeight : node.scrollWidth);
    const position = () => (axis === 'y' ? node.scrollTop : node.scrollLeft);
    const track = () =>
      (axis === 'y' ? rail.clientHeight : rail.clientWidth) - INSET * 2;
    const scrollable = () => total() - client() > 1;

    function scrollTo(value: number) {
      node.scrollTo({
        [axis === 'y' ? 'top' : 'left']: value,
        behavior: 'instant',
      });
    }

    function render() {
      const can = scrollable();
      const visible = can && (state.shown || state.hovered || state.dragging);
      rail.toggleAttribute('data-visible', visible);
      rail.toggleAttribute('data-expanded', state.hovered || state.dragging);
      if (!can) return;
      const length = track();
      const max = total() - client();
      state.size = Math.min(
        length,
        Math.max(MIN_THUMB, (length * client()) / total()),
      );
      state.offset = max > 0 ? (position() / max) * (length - state.size) : 0;
      const start = `${INSET + state.offset}px`;
      const size = `${state.size}px`;
      if (axis === 'y') {
        thumb.style.top = start;
        thumb.style.height = size;
      } else {
        thumb.style.left = start;
        thumb.style.width = size;
      }
    }

    // Wheel over the rail scrolls the element, as it would over the content.
    rail.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const line = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
        node.scrollBy({
          left: event.deltaX * line,
          top: event.deltaY * line,
          behavior: 'instant',
        });
        reveal(axis);
      },
      { passive: false },
    );
    rail.addEventListener('pointerenter', () => {
      state.hovered = true;
      render();
    });
    rail.addEventListener('pointerleave', () => {
      state.hovered = false;
      reveal(axis);
    });

    // Clicking the track pages toward the click, as macOS does by default.
    rail.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target !== rail) return;
      const rect = rail.getBoundingClientRect();
      const at =
        (axis === 'y' ? event.clientY - rect.top : event.clientX - rect.left) -
        INSET;
      const page = client() * 0.9;
      node.scrollBy({
        [axis === 'y' ? 'top' : 'left']: at < state.offset ? -page : page,
      });
    });

    thumb.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      thumb.setPointerCapture(event.pointerId);
      state.dragging = true;
      render();
      const from = axis === 'y' ? event.clientY : event.clientX;
      const start = position();
      const ratio = (total() - client()) / Math.max(track() - state.size, 1);
      const move = (moved: PointerEvent) =>
        scrollTo(
          start +
            ((axis === 'y' ? moved.clientY : moved.clientX) - from) * ratio,
        );
      const end = () => {
        state.dragging = false;
        reveal(axis);
        thumb.removeEventListener('pointermove', move);
        thumb.removeEventListener('pointerup', end);
        thumb.removeEventListener('pointercancel', end);
      };
      thumb.addEventListener('pointermove', move);
      thumb.addEventListener('pointerup', end);
      thumb.addEventListener('pointercancel', end);
    });

    return { axis, rail, state, render, scrollable };
  }

  /** Shows the scroller for `axis`, and fades it once scrolling has stopped for a moment. */
  function reveal(axis: Axis) {
    const rail = rails.find((r) => r.axis === axis)!;
    if (!rail.scrollable()) return;
    rail.state.shown = true;
    rail.render();
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      for (const r of rails) {
        r.state.shown = false;
        r.render();
      }
    }, LINGER_MS);
  }

  function renderAll() {
    for (const r of rails) r.render();
  }

  function onScroll() {
    if (performance.now() - keyAt < KEY_INTENT_MS) reveal(keyAxis);
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(renderAll);
  }

  function onWheel(event: WheelEvent) {
    if (Math.abs(event.deltaY) >= Math.abs(event.deltaX)) {
      if (event.deltaY) reveal('y');
    } else reveal('x');
  }

  function onKeydown(event: KeyboardEvent) {
    const axis = SCROLL_KEYS[event.key];
    if (!axis || isEditable(event.target)) return;
    keyAt = performance.now();
    keyAxis = axis;
  }

  function onPointerMove(event: PointerEvent) {
    if (event.pointerType !== 'mouse') return;
    const rect = node.getBoundingClientRect();
    if (rect.right - event.clientX <= EDGE) reveal('y');
    else if (rect.bottom - event.clientY <= EDGE) reveal('x');
  }

  function onTouchMove() {
    reveal('y');
    reveal('x');
  }

  node.addEventListener('scroll', onScroll, { passive: true });
  node.addEventListener('wheel', onWheel, { passive: true });
  node.addEventListener('keydown', onKeydown);
  node.addEventListener('pointermove', onPointerMove, { passive: true });
  node.addEventListener('touchmove', onTouchMove, { passive: true });
  const resize = new ResizeObserver(renderAll);
  resize.observe(node);

  return () => {
    clearTimeout(hideTimer);
    cancelAnimationFrame(frame);
    resize.disconnect();
    node.removeEventListener('scroll', onScroll);
    node.removeEventListener('wheel', onWheel);
    node.removeEventListener('keydown', onKeydown);
    node.removeEventListener('pointermove', onPointerMove);
    node.removeEventListener('touchmove', onTouchMove);
    for (const r of rails) r.rail.remove();
    node.style.scrollbarWidth = previousWidth;
    node.style.removeProperty('anchor-name');
  };
}
