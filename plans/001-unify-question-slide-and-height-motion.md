# 001 — Unify the question slide and height motion on the house curve

- **Commit:** 7d4ba90 (plus uncommitted stepper work in `request-view.svelte`)
- **Severity:** MEDIUM
- **Category:** Easing & duration / Cohesion / Accessibility
- **Estimated scope:** 1 file, ~10 lines

## Problem

The question card's three moving parts use unrelated timing. The slide uses Svelte `fly` with its default `cubicOut` (a weak built-in curve), the height uses Tailwind's built-in `ease-out`, and neither matches the repo's house curve `cubic-bezier(0.19, 1, 0.22, 1)` (`dialog-motion` in `src/app.css`). The exit runs as long as the enter (200ms) even though the user has already decided to move on. Under `prefers-reduced-motion`, duration is forced to 0, so the change is a hard cut rather than a gentler fade ("reduced motion means gentler, not zero").

## Where

| File | Lines | What's there |
| --- | --- | --- |
| `src/lib/components/conversation/request-view.svelte` | 67–71 | `slide()` params for `fly` |
| `src/lib/components/conversation/request-view.svelte` | 183 | height transition classes |
| `src/lib/components/conversation/request-view.svelte` | 190–191 | `in:fly` / `out:fly` |

### Current code

```svelte
const reduceMotion = new MediaQuery('prefers-reduced-motion: reduce');
const slide = (side: 1 | -1) => ({
  x: reduceMotion.current ? 0 : 32 * direction * side,
  duration: reduceMotion.current ? 0 : 200,
});
...
class="-m-1 grid overflow-clip p-1 transition-[height] duration-200 ease-out motion-reduce:transition-none"
...
in:fly={slide(1)}
out:fly={slide(-1)}
```

## Target

```svelte
import { expoOut } from 'svelte/easing';

// Enter 200ms, exit 150ms (same split as dialog-motion). expoOut is the
// closest svelte/easing match to cubic-bezier(0.19, 1, 0.22, 1).
const slide = (side: 1 | -1) => ({
  x: reduceMotion.current ? 0 : 32 * direction * side,
  duration: side === 1 ? 200 : 150,
  easing: expoOut,
});
```

- Height: `transition-[height] duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] motion-reduce:transition-none` (keep the reduced-motion opt-out; a height change is layout, not travel, but an instant resize is fine).
- Under reduced motion the slide keeps its 200/150ms duration with `x: 0`, so `fly` only fades opacity.

**Why these values:** the curve matches `dialog-motion` so the card feels like the same family as dialogs. Exit 150ms matches `dialog-out`. Enter 200ms matches `dialog-in` and the height transition, so slide and resize read as one entity. A steep curve front-loads the movement, so no longer duration is needed.

## Conventions to follow

- House curve and the 200ms/150ms enter/exit split: `@utility dialog-motion` in `src/app.css` (~line 181).
- Reduced motion there keeps the fade and drops the movement — do the same.

## Steps

1. Import `expoOut` from `svelte/easing`.
2. Update `slide()` as in Target (remove the `duration: reduceMotion.current ? 0 : 200` branch).
3. Replace `ease-out` on the height wrapper with `ease-[cubic-bezier(0.19,1,0.22,1)]`.
4. Leave `in:fly` / `out:fly` call sites unchanged.

## Out of scope

- The radio dot/press animation (see plan 003).
- Anything in `assistant-view.svelte`.
- Do not add a motion library.

## Verification

**Build**
- [ ] `npx svelte-check --threshold error` passes.

**Behavior**
- [ ] Next/Back slide forward = left, back = right (unchanged).
- [ ] With `prefers-reduced-motion: reduce` emulated, questions crossfade with no horizontal movement.

**Feel**
- [ ] Record and scrub: the slide should be steep at the start and settle; the old question should clear slightly faster than the new one arrives.
- [ ] Slide and height should finish together; if the height lands visibly before/after the slide, adjust durations, not the curve.

## Notes

`expoOut` is an approximation of the cubic-bezier, not an exact match. If a pixel-exact match matters, pass a small custom easing function built from the bezier.
