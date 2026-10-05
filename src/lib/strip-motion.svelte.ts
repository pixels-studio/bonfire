import type { TransitionConfig } from 'svelte/transition';
import { reducedMotion } from '$lib/utils';

const DURATION = 200;
/** On screen and changing shape, so it eases in and out. */
const EASING = 'cubic-bezier(0.65, 0, 0.35, 1)';
/** Clips to the card inside the section's padding, keeping its corners round. */
const CLIP = 'inset(0 0.25rem round var(--radius-lg))';
/** How long the strip must go without scrolling before a scroll counts as over. */
const SCROLL_IDLE_MS = 100;

type Before = { width: number; content: number };

/**
 * Animates the pane strip from one layout to the next. Every section that
 * grows in, shrinks away or changes size is animated from the same place with
 * the same timing, so the strip's total width holds steady and neighbors slide
 * over in step. A section's content keeps the wider of its two widths meanwhile,
 * clipped rather than reflowed on every frame, and settles once at the end.
 *
 * Call `measure` before the DOM updates and `play` after it.
 */
export class StripMotion {
  /** Whether sections are moving, which holds off scroll snapping. */
  active = $state(false);
  #before = new Map<HTMLElement, Before>();
  #running = new Map<HTMLElement, Animation>();
  #scrollTimer: ReturnType<typeof setTimeout> | undefined;
  #stop = () => {};

  constructor(private strip: () => HTMLElement | undefined) {}

  #sections() {
    const strip = this.strip();
    return strip
      ? [...strip.querySelectorAll<HTMLElement>(':scope > [data-strip-id]')]
      : [];
  }

  /** Records where each section is now, mid-animation included. */
  measure() {
    this.#before.clear();
    for (const section of this.#sections())
      this.#before.set(section, {
        width: section.getBoundingClientRect().width,
        content: content(section)?.offsetWidth ?? 0,
      });
  }

  /**
   * Animates every section from where `measure` found it to where it sits now.
   * A new section grows in from nothing if `enters` allows it, and one marked by
   * `leave` shrinks away.
   */
  play(enters: (id: string) => boolean) {
    const strip = this.strip();
    if (!strip || reducedMotion()) return;
    const sections = this.#sections();
    // A section already shrinking away is removed on schedule, so everything moves
    // on its clock; sharing one timeline is what keeps the strip's width steady.
    const duration = Math.min(
      DURATION,
      ...sections
        .filter((section) => 'leaving' in section.dataset)
        .map((section) => this.#running.get(section))
        .filter((animation) => animation?.playState === 'running')
        .map((animation) => DURATION - Number(animation!.currentTime)),
    );
    // Lets go of the last animation first, so the new layout measures as it is.
    for (const section of sections) this.#release(section);
    const bounds = strip.getBoundingClientRect();
    /** How far the sections leaving ahead of this one will have closed up. */
    let closing = 0;
    const moves = sections.flatMap((section) => {
      const before = this.#before.get(section);
      const leaving = 'leaving' in section.dataset;
      if (!before && !enters(section.dataset.stripId!)) return [];
      const rect = section.getBoundingClientRect();
      if (leaving) closing += rect.width;
      // Growing past the strip's right edge, it would only be seen as a late scroll.
      if (!before && rect.left - closing >= bounds.right) return [];
      const from = before?.width ?? 0;
      const to = leaving ? 0 : rect.width;
      if (Math.abs(from - to) < 0.5) return [];
      const width = Math.max(
        before?.content ?? 0,
        content(section)?.offsetWidth ?? 0,
      );
      return [{ section, from, to, width, leaving }];
    });
    this.#before.clear();

    for (const { section, from, to, width, leaving } of moves) {
      const inner = content(section);
      if (inner) inner.style.width = `${width}px`;
      section.style.overflow = 'hidden';
      section.style.clipPath = CLIP;
      const animation = section.animate(
        [frame(section, from), frame(section, to)],
        // Fills forwards so a leaving section stays shut until it's removed.
        { duration, easing: EASING, fill: 'forwards' },
      );
      this.#running.set(section, animation);
      animation.onfinish = () => {
        // A leaving section holds its end state until it's gone, so it can't spring back.
        if (!leaving) this.#release(section);
        this.#settle();
      };
    }
    if (moves.length) this.#start(strip);
  }

  #release(section: HTMLElement) {
    const animation = this.#running.get(section);
    if (!animation) return;
    animation.cancel();
    this.#running.delete(section);
    section.style.overflow = '';
    section.style.clipPath = '';
    const inner = content(section);
    if (inner) inner.style.width = '';
  }

  #start(strip: HTMLElement) {
    if (this.active) return;
    this.active = true;
    // Not `scrollend`: a strip that scrolls only because it got shorter never sends one.
    const scroll = () => {
      clearTimeout(this.#scrollTimer);
      this.#scrollTimer = setTimeout(() => {
        this.#scrollTimer = undefined;
        this.#settle();
      }, SCROLL_IDLE_MS);
    };
    strip.addEventListener('scroll', scroll);
    this.#stop = () => strip.removeEventListener('scroll', scroll);
  }

  /**
   * Snapping comes back once nothing is moving and any scroll begun alongside has
   * ended; turned on mid-scroll, it would yank the strip to the nearest pane.
   */
  #settle() {
    for (const [section, animation] of this.#running)
      if (!section.isConnected) this.#running.delete(section);
      else if (animation.playState === 'running') return;
    if (this.#scrollTimer) return;
    this.#stop();
    this.active = false;
  }
}

/**
 * A section's size at one end of its animation. At nothing, its padding goes too,
 * so it truly grows from, or shrinks to, no width at all.
 */
function frame(section: HTMLElement, width: number): Keyframe {
  const padding = width ? getComputedStyle(section).paddingInline : '0px';
  return {
    flexBasis: `${width}px`,
    minWidth: `${width}px`,
    paddingInline: padding,
  };
}

function content(section: HTMLElement) {
  return section.firstElementChild as HTMLElement | null;
}

/**
 * Keeps a section in the strip while `StripMotion` shrinks it away. Without
 * `animate`, as on a project switch, it goes at once.
 */
export function leave(
  node: HTMLElement,
  { animate = true }: { animate?: boolean } = {},
): TransitionConfig {
  if (!animate || reducedMotion()) return { duration: 0 };
  node.dataset.leaving = '';
  return { duration: DURATION };
}
