import type { LimitWindow, ProviderLimits } from '../../shared/contracts';

/** The part of the Claude SDK's `/usage` answer that holds plan limits. */
export type ClaudeUsage = {
  subscription_type: string | null;
  rate_limits_available: boolean;
  rate_limits: {
    five_hour?: ClaudeWindow | null;
    seven_day?: ClaudeWindow | null;
    model_scoped?: (ClaudeWindow & { display_name: string })[];
  } | null;
};
type ClaudeWindow = { utilization: number | null; resets_at: string | null };

/** The part of Codex's `account/rateLimits/read` answer that holds plan limits. */
export type CodexRateLimits = {
  rateLimits: {
    planType?: string | null;
    primary?: CodexWindow | null;
    secondary?: CodexWindow | null;
  };
};
type CodexWindow = {
  usedPercent: number;
  windowDurationMins?: number | null;
  /** Unix seconds. */
  resetsAt?: number | null;
};

const WEEK_MINUTES = 7 * 24 * 60;

function claudeWindow(
  id: string,
  label: string,
  window: ClaudeWindow | null | undefined,
): LimitWindow[] {
  if (window?.utilization == null) return [];
  const resetsAt = window.resets_at ? Date.parse(window.resets_at) : NaN;
  return [
    {
      id,
      label,
      usedPercent: window.utilization,
      resetsAt: Number.isNaN(resetsAt) ? undefined : resetsAt,
    },
  ];
}

/** Session, weekly, and per-model weekly (such as Fable) limits of a claude.ai plan. */
export function claudeLimits(usage: ClaudeUsage): ProviderLimits {
  if (!usage.rate_limits_available || !usage.rate_limits)
    throw Error('Plan limits need a Claude subscription (not an API key).');
  const { five_hour, seven_day, model_scoped = [] } = usage.rate_limits;
  return {
    provider: 'claude',
    plan: usage.subscription_type ?? undefined,
    windows: [
      ...claudeWindow('session', 'Session', five_hour),
      ...claudeWindow('weekly', 'Weekly', seven_day),
      ...model_scoped.flatMap((window) =>
        claudeWindow(
          `model:${window.display_name}`,
          `${window.display_name} weekly`,
          window,
        ),
      ),
    ],
  };
}

/** The weekly limit of a Codex plan. */
export function codexLimits({ rateLimits }: CodexRateLimits): ProviderLimits {
  const weekly = [rateLimits.primary, rateLimits.secondary].find(
    (window) => window?.windowDurationMins === WEEK_MINUTES,
  );
  return {
    provider: 'codex',
    plan: rateLimits.planType ?? undefined,
    windows: weekly
      ? [
          {
            id: 'weekly',
            label: 'Weekly',
            usedPercent: weekly.usedPercent,
            resetsAt: weekly.resetsAt ? weekly.resetsAt * 1000 : undefined,
          },
        ]
      : [],
  };
}
