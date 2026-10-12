export type RateLimitDecision = { allowed: boolean; retryAfterMs: number };

const MAX_TRACKED_KEYS = 10_000;

// In memory, so on a serverless platform each instance keeps its own window.
export function createRateLimiter({ windowMs, max }: { windowMs: number; max: number }) {
  const hits = new Map<string, number[]>();

  return {
    check(key: string, now = Date.now()): RateLimitDecision {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return { allowed: false, retryAfterMs: windowMs - (now - recent[0]) };
      }
      recent.push(now);
      hits.delete(key);
      hits.set(key, recent);
      if (hits.size > MAX_TRACKED_KEYS) {
        hits.delete(hits.keys().next().value as string);
      }
      return { allowed: true, retryAfterMs: 0 };
    },
  };
}
