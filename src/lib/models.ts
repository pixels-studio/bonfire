import type { AssistantProvider, ReasoningEffort } from '$shared/contracts';
import { PROVIDER_LABELS } from '$shared/domain';

export type Model = {
  value: string;
  label: string;
  contextWindow: number;
  provider: AssistantProvider;
};

export const PROVIDERS = Object.keys(PROVIDER_LABELS) as AssistantProvider[];

/** Assumed for models whose window isn't known; a response reports the real one. */
export const DEFAULT_CONTEXT_WINDOWS: Record<AssistantProvider, number> = {
  claude: 200_000,
  codex: 258_400,
};

/** Models offered until the providers report their own lists. */
export const MODELS: Model[] = [
  {
    value: 'opus',
    label: 'Opus 5.5',
    contextWindow: 200_000,
    provider: 'claude',
  },
  {
    value: 'sonnet',
    label: 'Sonnet 5.5',
    contextWindow: 200_000,
    provider: 'claude',
  },
  {
    value: 'sonnet-1m',
    label: 'Sonnet 5.5 (1M)',
    contextWindow: 1_000_000,
    provider: 'claude',
  },
  {
    value: 'haiku',
    label: 'Haiku 4.5',
    contextWindow: 200_000,
    provider: 'claude',
  },
  {
    value: 'gpt-5.6-terra',
    label: 'Terra',
    contextWindow: 300_000,
    provider: 'codex',
  },
  {
    value: 'gpt-6-astra',
    label: 'Astra',
    contextWindow: 400_000,
    provider: 'codex',
  },
];

export const EFFORT_LEVELS: { value: ReasoningEffort; label: string }[] = [
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Max' },
];
