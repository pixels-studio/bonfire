import type { AssistantProvider } from '../../shared/contracts';

/** What one model call used, with input split by how it was billed. */
export type TokenCounts = {
  /** Input that was neither read from nor written to the cache. */
  input: number;
  cacheRead: number;
  /** Cache writes with the 5-minute lifetime. */
  cacheWrite5m: number;
  /** Cache writes with the 1-hour lifetime. */
  cacheWrite1h: number;
  output: number;
};

/** List prices in USD per million tokens. */
export type Price = {
  input: number;
  output: number;
  cacheRead: number;
};

// Written cache costs 1.25x the input price for 5 minutes and 2x for 1 hour.
const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2;

/** Claude models, most specific first. Codex models are left unpriced. */
const CLAUDE_PRICES: [RegExp, Price][] = [
  [/fable-5-1/, { input: 10, output: 50, cacheRead: 0.25 }],
  [/fable-5/, { input: 10, output: 50, cacheRead: 1 }],
  [/opus-5-5/, { input: 4, output: 20, cacheRead: 0.2 }],
  [/opus-(5|4)/, { input: 5, output: 25, cacheRead: 0.5 }],
  [/sonnet-5/, { input: 2, output: 10, cacheRead: 0.2 }],
  [/sonnet-4/, { input: 3, output: 15, cacheRead: 0.3 }],
  [/haiku-4-5/, { input: 1, output: 5, cacheRead: 0.1 }],
];

export function priceFor(
  provider: AssistantProvider,
  model: string,
): Price | undefined {
  if (provider !== 'claude') return undefined;
  return CLAUDE_PRICES.find(([pattern]) => pattern.test(model))?.[1];
}

/** USD for one call. */
export function costOf(price: Price, counts: TokenCounts) {
  return (
    (counts.input * price.input +
      counts.cacheRead * price.cacheRead +
      counts.cacheWrite5m * price.input * CACHE_WRITE_5M +
      counts.cacheWrite1h * price.input * CACHE_WRITE_1H +
      counts.output * price.output) /
    1_000_000
  );
}

/** USD not spent because `counts.cacheRead` came from cache instead of as fresh input. */
export function cacheSavingsOf(price: Price, counts: TokenCounts) {
  return (counts.cacheRead * (price.input - price.cacheRead)) / 1_000_000;
}
