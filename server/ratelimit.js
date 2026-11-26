/** Fixed-window per-key rate limiter with bounded memory. */
export class RateLimiter {
  constructor(windowMs, maxKeys = 2000) {
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.hits = new Map();
  }

  allow(key, limit, now = Date.now()) {
    if (this.hits.size > this.maxKeys) {
      for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
      if (this.hits.size > this.maxKeys) this.hits.clear();
    }
    const entry = this.hits.get(key);
    if (!entry || entry.reset <= now) {
      this.hits.set(key, { count: 1, reset: now + this.windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  }
}
