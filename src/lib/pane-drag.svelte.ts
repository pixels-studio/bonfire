import { reducedMotion } from '$lib/utils';

const THRESHOLD = 4;
const SETTLE_MS = 220;
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
const EDGE = 80;
const MAX_SCROLL_SPEED = 18;

type Drag = {
  id: string;
  ids: string[];
  from: number;
  widths: Record<string, number>;
  /** Pane centers in strip content coordinates, measured when the drag started. */
  centers: Record<string, number>;
  startX: number;
  startScroll: number;
  clientX: number;
  offset: number;
  active: boolean;
  settling: boolean;
  /** The slot chosen on release, frozen so neighbors hold still while the pane settles. */
  to?: number;
};

/**
 * Pointer-driven reordering for the pane strip. The grabbed pane follows the
 * pointer while its neighbors slide aside, and the order is only committed once
 * it has settled into its slot, so nothing in the DOM moves mid-drag.
 */
export class PaneDrag {
  #drag = $state<Drag>();
  #frame = 0;

  constructor(
    private strip: () => HTMLElement | undefined,
    private commit: (ids: string[]) => void,
  ) {}

  get active() {
    return !!this.#drag?.active;
  }

  isDragging(id: string) {
    return this.active && this.#drag?.id === id;
  }

  start(event: PointerEvent, id: string, ids: string[]) {
    const strip = this.strip();
    if (event.button !== 0 || !strip || this.#drag) return;
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);

    const base = strip.getBoundingClientRect().left - strip.scrollLeft;
    const widths: Record<string, number> = {};
    const centers: Record<string, number> = {};
    for (const section of strip.querySelectorAll<HTMLElement>(
      '[data-pane-id]',
    )) {
      const rect = section.getBoundingClientRect();
      const paneId = section.dataset.paneId!;
      widths[paneId] = rect.width;
      centers[paneId] = rect.left - base + rect.width / 2;
    }
    this.#drag = {
      id,
      ids,
      from: ids.indexOf(id),
      widths,
      centers,
      startX: event.clientX,
      startScroll: strip.scrollLeft,
      clientX: event.clientX,
      offset: 0,
      active: false,
      settling: false,
    };

    const move = (event: PointerEvent) => this.#move(event.clientX);
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      end(true);
    };
    const end = (cancel: boolean) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', drop);
      handle.removeEventListener('pointercancel', abort);
      window.removeEventListener('keydown', keydown, true);
      this.#end(cancel);
    };
    const drop = () => end(false);
    const abort = () => end(true);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', drop);
    handle.addEventListener('pointercancel', abort);
    window.addEventListener('keydown', keydown, true);
  }

  /** Inline style for a pane: where it sits relative to its resting slot. */
  style(id: string) {
    const drag = this.#drag;
    if (!drag?.active) return undefined;
    const ease = reducedMotion() ? 'none' : `transform ${SETTLE_MS}ms ${EASE}`;
    if (id === drag.id) {
      const transition = drag.settling ? ease : 'none';
      return `transform: translateX(${drag.offset}px); transition: ${transition}; z-index: 10; position: relative;`;
    }
    return `transform: translateX(${this.#shift(drag, id)}px); transition: ${ease};`;
  }

  #target(drag: Drag) {
    if (drag.to !== undefined) return drag.to;
    const center = drag.centers[drag.id] + drag.offset;
    let index = drag.from;
    for (let i = drag.from + 1; i < drag.ids.length; i++)
      if (center > drag.centers[drag.ids[i]]) index = i;
    for (let i = drag.from - 1; i >= 0; i--)
      if (center < drag.centers[drag.ids[i]]) index = i;
    return index;
  }

  #shift(drag: Drag, id: string) {
    const index = drag.ids.indexOf(id);
    const to = this.#target(drag);
    const width = drag.widths[drag.id];
    if (drag.from < index && index <= to) return -width;
    if (to <= index && index < drag.from) return width;
    return 0;
  }

  #move(clientX: number) {
    const drag = this.#drag;
    if (!drag || drag.settling) return;
    drag.clientX = clientX;
    if (!drag.active) {
      if (Math.abs(clientX - drag.startX) < THRESHOLD) return;
      drag.active = true;
      this.#frame = requestAnimationFrame(this.#tick);
    }
    this.#measure(drag);
  }

  #measure(drag: Drag) {
    const strip = this.strip();
    const scrolled = strip ? strip.scrollLeft - drag.startScroll : 0;
    drag.offset = drag.clientX - drag.startX + scrolled;
  }

  /** Scrolls the strip while the pointer is near its edge. */
  #tick = () => {
    const drag = this.#drag;
    const strip = this.strip();
    if (!drag?.active || drag.settling || !strip) return;
    const { left, right } = strip.getBoundingClientRect();
    const toEdge = Math.min(drag.clientX - left, right - drag.clientX);
    if (toEdge < EDGE) {
      const direction = drag.clientX - left < right - drag.clientX ? -1 : 1;
      const speed = MAX_SCROLL_SPEED * (1 - Math.max(toEdge, 0) / EDGE);
      strip.scrollLeft += direction * speed;
      this.#measure(drag);
    }
    this.#frame = requestAnimationFrame(this.#tick);
  };

  #end(cancel: boolean) {
    cancelAnimationFrame(this.#frame);
    const drag = this.#drag;
    if (!drag || drag.settling) return;
    if (!drag.active) {
      this.#drag = undefined;
      return;
    }
    const to = cancel ? drag.from : this.#target(drag);
    const between =
      to > drag.from
        ? drag.ids.slice(drag.from + 1, to + 1)
        : drag.ids.slice(to, drag.from);
    const travel = between.reduce((sum, id) => sum + drag.widths[id], 0);
    drag.settling = true;
    drag.to = to;
    drag.offset = to > drag.from ? travel : -travel;

    setTimeout(
      () => {
        if (to !== drag.from) {
          const ids = drag.ids.filter((id) => id !== drag.id);
          ids.splice(to, 0, drag.id);
          this.commit(ids);
        }
        this.#drag = undefined;
      },
      reducedMotion() ? 0 : SETTLE_MS,
    );
  }
}
