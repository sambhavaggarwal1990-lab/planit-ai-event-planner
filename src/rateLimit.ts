export interface RateLimiter {
  /** Records a request for `key` and returns true when that key is over its limit. */
  isLimited(key: string): boolean;
}

export interface RateLimiterOptions {
  max?: number;
  windowMs?: number;
  now?: () => number;
}

/** Sliding-window rate limiter that keeps its memory bounded. */
export function createRateLimiter({ max = 10, windowMs = 60_000, now = Date.now }: RateLimiterOptions = {}): RateLimiter {
  const hits = new Map<string, number[]>();

  function prune(t: number): void {
    for (const [key, times] of hits) {
      if (!times.some((time) => t - time < windowMs)) hits.delete(key);
    }
  }

  return {
    isLimited(key) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((time) => t - time < windowMs);
      recent.push(t);
      hits.set(key, recent);
      if (hits.size > 5000) prune(t);
      return recent.length > max;
    },
  };
}
