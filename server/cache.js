/**
 * Bounded TTL cache with in-flight de-duplication, so identical concurrent
 * requests share one upstream call.
 */

/** TTL cache with a size bound and request coalescing. */
export class TtlCache {
  /**
   * @param {number} ttlMs entry lifetime in milliseconds
   * @param {number} maxEntries oldest entry is dropped beyond this
   */
  constructor(ttlMs, maxEntries) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.map = new Map();
    this.pending = new Map();
  }

  /**
   * @param {string} key
   * @param {number} [now]
   * @returns {*} the cached value, or undefined
   */
  get(key, now = Date.now()) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= now) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  /**
   * @param {string} key
   * @param {*} value
   * @param {number} [now]
   */
  set(key, value, now = Date.now()) {
    this.map.delete(key);
    if (this.map.size >= this.maxEntries) this.map.delete(this.map.keys().next().value);
    this.map.set(key, { value, expires: now + this.ttlMs });
  }

  /**
   * Return the cached value, or run `loader` once and cache its result.
   * `shouldCache(value)` can veto caching (for example degraded results).
   * @param {string} key
   * @param {() => Promise<*>} loader
   * @param {(value: *) => boolean} [shouldCache]
   * @returns {Promise<*>}
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
