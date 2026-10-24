/** Sliding-window rate limiter that keeps its memory bounded. */
export function createRateLimiter({ max = 10, windowMs = 60_000, now = Date.now } = {}) {
  const hits = new Map();

  function prune(t) {
    for (const [key, times] of hits) {
      if (!times.some((x) => t - x < windowMs)) hits.delete(key);
    }
  }

  return {
    isLimited(key) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
      recent.push(t);
      hits.set(key, recent);
      if (hits.size > 5000) prune(t);
      return recent.length > max;
    },
  };
}
