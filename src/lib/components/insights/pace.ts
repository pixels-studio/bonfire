import type { AssistantProvider, ProviderLimits } from '$shared/contracts';

/**
 * How often usage loads again: at most once per `minGapMs` after turns end, however many end,
 * and every `intervalMs` while agents work, for what no event reports. No interval: it loads
 * only as turns end.
 */
export type Pace = { minGapMs: number; intervalMs?: number };

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** Token stats are read from the logs on this machine, only what was appended: cheap. */
export function tokensPace(working: boolean): Pace {
  return { minGapMs: 2 * SECOND, intervalMs: working ? MINUTE : undefined };
}

/**
 * Codex reports its limits as turns use them and main answers from those, so reading them
 * is mostly free. Claude's are asked of a CLI started for the purpose, so they're read
 * sparingly, and more often only as the plan nears its limit, when they matter most.
 */
export function limitsPace(
  provider: AssistantProvider,
  limits: ProviderLimits | undefined,
  working: boolean,
): Pace {
  const pace = (minGapMs: number, intervalMs: number): Pace => ({
    minGapMs,
    intervalMs: working ? intervalMs : undefined,
  });
  if (provider === 'codex') return pace(2 * SECOND, 5 * MINUTE);
  const used = Math.max(
    0,
    ...(limits?.windows.map(({ usedPercent }) => usedPercent) ?? []),
  );
  if (used >= 90) return pace(15 * SECOND, MINUTE);
  if (used >= 75) return pace(30 * SECOND, 2 * MINUTE);
  return pace(MINUTE, 5 * MINUTE);
}
