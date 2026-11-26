/**
 * Fixed-window per-key rate limiter with bounded memory.
 */
import { RATE_LIMIT_MAX_KEYS } from './config.js';

/** Fixed-window per-key rate limiter with bounded memory. */
export class RateLimiter {
  /**
   * @param {number} windowMs
   * @param {number} [maxKeys]
   */
  constructor(windowMs, maxKeys = RATE_LIMIT_MAX_KEYS) {
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.hits = new Map();
  }

  /**
   * Count a hit and say whether the key is still within `limit` for this window.
   * @param {string} key
   * @param {number} limit
   * @param {number} [now]
   * @returns {boolean}
   */
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
