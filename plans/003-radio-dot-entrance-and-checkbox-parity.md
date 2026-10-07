# 003 — Soften the radio dot entrance and give checkboxes matching feedback

- **Commit:** 7d4ba90 (plus uncommitted stepper work)
- **Severity:** MEDIUM (needs a human feel decision)
- **Category:** Physicality & origin / Cohesion / Missed opportunity
- **Estimated scope:** 2 files, ~8 lines

## Problem

The radio's white dot enters from `scale(0)` with an overshooting curve. "Nothing appears from nothing": the rule is `scale(0.9–0.95)` plus opacity. The bounce (`cubic-bezier(0.34, 1.56, 0.64, 1)`) is playful; the audit default is zero bounce unless chosen for brand — it was added at the user's request ("nice animation"), so keep it if intended. Separately, multi-select questions use a checkbox that has no equivalent feedback (the check mark appears via `{#if}`), so the two controls feel inconsistent. The 0.9 press scale on a 20px control is more visible than the "felt, not seen" 0.97; at this size 0.97 is under 1px, so this one is a judgment call.

## Where

| File | Lines | What's there |
| --- | --- | --- |
| `src/lib/components/ui/radio-group/radio-group-item.svelte` | 15, 22 | root transition + `active:scale-90`; dot `scale-0` + overshoot |
| `src/lib/components/ui/checkbox/checkbox.svelte` | 22–32 | check icon rendered with `{#if checked}` |

### Current code

```svelte
class="... transition-[background-color,border-color,transform] duration-150 active:scale-90 ..."
<span class="size-1.5 scale-0 rounded-full bg-white opacity-0 transition-[transform,opacity] duration-250 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-data-[state=checked]/radio:scale-100 ..."></span>
```

## Target

Radio dot (keeps the pop, less from-nothing):

```svelte
class="size-1.5 scale-50 rounded-full bg-white opacity-0 transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-data-[state=checked]/radio:scale-100 group-data-[state=checked]/radio:opacity-100 motion-reduce:transition-none"
```

Press: change `active:scale-90` to `active:scale-95` (still visible on a 20px target; 0.97 would be invisible).

Checkbox parity: keep the `{#if checked}` icon but wrap it so it fades/scales in with the same values — a `<span class="scale-50 opacity-0 ... group-data-[state=checked]:scale-100 group-data-[state=checked]:opacity-100">` always rendered, with the root given `group/checkbox`. Reduced motion: `motion-reduce:transition-none`.

**Why these values:** 0.5 start keeps a visible "pop" without appearing from nothing; 200ms and the overshoot curve are the playful variant — if you want professional, replace with `cubic-bezier(0.19, 1, 0.22, 1)` and no overshoot.

## Conventions to follow

- Reduced-motion opt-outs use `motion-reduce:transition-none` as in the existing file.
- Keep the shared components generic — don't hard-code request-view sizing into them.

## Steps

1. Edit the radio dot classes as in Target.
2. Change the press scale to 0.95.
3. Render the checkbox check icon always, driven by `data-[state=checked]`.
4. Compare both controls side by side in the app.

## Out of scope

- Slide/height motion (plans 001, 002).
- Size/color overrides in `request-view.svelte` (`control`).

## Verification

**Build**
- [ ] `npx svelte-check --threshold error` passes.

**Behavior**
- [ ] Radio and checkbox still toggle by click, keyboard (Space/arrow keys), and via the label.
- [ ] Reduced motion: no scaling, state changes are instant.

**Feel**
- [ ] Record and scrub frame by frame; the dot should settle without visibly "wobbling".
- [ ] Decide with fresh eyes whether the overshoot fits the product's personality.

## Notes

Whether the bounce fits the brand can't be judged from code. This is a human call.
