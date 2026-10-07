# 002 — Stop the card's height animation from re-laying-out the chat feed

- **Commit:** 7d4ba90 (plus uncommitted stepper work)
- **Severity:** MEDIUM (unverified — measure first)
- **Category:** Performance
- **Estimated scope:** 1–2 files, ~10 lines

## Problem

The question card animates `height` (a layout property). It sits in a `shrink-0` footer under a `flex-1` feed, so every frame of the 200ms transition resizes the feed. The feed's height is bound to state (`bind:clientHeight={feedHeight}`) which drives `style:min-height` on the latest turn, so each frame also triggers a Svelte update and re-layout of the latest conversation turn. On a long turn this can drop frames. Layout properties are the HIGH-severity performance signal; it is MEDIUM here because the card has few children and the cost depends on turn size. I could not measure this from code.

## Where

| File | Lines | What's there |
| --- | --- | --- |
| `src/lib/components/conversation/request-view.svelte` | 183–188 | height transition + `bind:offsetHeight` |
| `src/lib/components/assistant-view/assistant-view.svelte` | 110, 116, 411, 432 | `FEED_PADDING`, `feedHeight`, `bind:clientHeight`, `style:min-height` |

### Current code

```svelte
<!-- assistant-view.svelte:411 / 432 -->
bind:clientHeight={feedHeight}
style:min-height={`${Math.max(0, feedHeight - FEED_PADDING)}px`}
```

## Target

First reproduce: open DevTools Performance, record a Next press on a question card in a pane with a very long latest turn (50+ messages), and look for long Layout slices and dropped frames during the 200ms.

Only if frames drop, apply the cheapest fix that works:

1. **Preferred:** let the card overlay the feed instead of resizing it during the transition — hold the footer at its final height immediately and animate only the card's content (clip/translate), or
2. Throttle `feedHeight` updates while a card transition runs (skip updates until `transitionend`).

If there's no measurable jank, close this plan as "no change needed" and keep the height transition.

## Conventions to follow

- Per the audit: animate `transform`/`opacity` where possible; layout properties are only acceptable on small, few-child elements.
- No motion libraries.

## Steps

1. Record the baseline described under Target.
2. Decide: jank or no jank. Write the result in Notes.
3. If jank, implement fix 1, falling back to fix 2.
4. Re-record to confirm.

## Out of scope

- The slide animation and easing values (plan 001).
- Changing how `latest` min-height works for normal streaming.

## Verification

**Build**
- [ ] `npx svelte-check --threshold error` passes.

**Behavior**
- [ ] Following behavior (`trackFollowing`, scroll-to-bottom button) is unchanged after answering a question.
- [ ] No scroll jump in the feed while the card resizes.

**Feel**
- [ ] Record and scrub with a long conversation open: steady frames through Next/Back.
- [ ] Test on the slowest machine you have.

## Notes

Not measured. This is a code-reading inference about the `feedHeight` binding.
