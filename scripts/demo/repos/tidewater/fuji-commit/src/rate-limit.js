/**
 * A token bucket per client: each holds up to `burst` requests and refills at
 * `perMinute` a minute. A request that finds the bucket empty is refused.
 */
export function createRateLimiter({ perMinute = 60, burst = 20, now = Date.now } = {}) {
  const buckets = new Map();
  const refillPerMs = perMinute / 60_000;

  return function take(key) {
    const time = now();
    const bucket = buckets.get(key) ?? { tokens: burst, at: time };
    bucket.tokens = Math.min(burst, bucket.tokens + (time - bucket.at) * refillPerMs);
    bucket.at = time;
    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    buckets.set(key, bucket);
    return {
      allowed,
      remaining: Math.floor(bucket.tokens),
      retryAfterSeconds: allowed ? 0 : Math.ceil((1 - bucket.tokens) / refillPerMs / 1000),
    };
  };
}
