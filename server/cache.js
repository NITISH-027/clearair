// Bounded TTL cache with in-flight de-duplication, so identical concurrent
// requests share one upstream call.

export class TtlCache {
  constructor(ttlMs, maxEntries) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.map = new Map();
    this.pending = new Map();
  }

  get(key, now = Date.now()) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= now) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key, value, now = Date.now()) {
    this.map.delete(key);
    if (this.map.size >= this.maxEntries) this.map.delete(this.map.keys().next().value);
    this.map.set(key, { value, expires: now + this.ttlMs });
  }

  /**
   * Return the cached value, or run `loader` once and cache its result.
   * `shouldCache(value)` can veto caching (for example degraded results).
   */
  async getOrLoad(key, loader, shouldCache = () => true) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
    const promise = (async () => {
      try {
        const value = await loader();
        if (shouldCache(value)) this.set(key, value);
        return value;
      } finally {
        this.pending.delete(key);
      }
    })();
    this.pending.set(key, promise);
    return promise;
  }
}
