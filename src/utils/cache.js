'use strict';

/**
 * Small TTL + LRU cache used for outbound API responses (Wikipedia).
 * Keeping this in-process avoids hammering third-party APIs without dragging
 * in Redis for what is a handful of kilobytes.
 */
class TtlCache {
  /**
   * @param {object} [options]
   * @param {number} [options.ttlMs] entry lifetime
   * @param {number} [options.max]   maximum number of entries
   */
  constructor({ ttlMs = 300000, max = 500 } = {}) {
    this.ttlMs = ttlMs;
    this.max = max;
    /** @type {Map<string, { value: unknown, expiresAt: number }>} */
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh recency for the LRU eviction order.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    if (ttlMs <= 0) return value;
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (this.store.size > this.max) {
      const oldest = this.store.keys().next().value;
      this.store.delete(oldest);
    }
    return value;
  }

  /** get-or-compute; concurrent misses share one in-flight promise. */
  async wrap(key, producer, ttlMs = this.ttlMs) {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const pending = producer();
    this.set(key, pending, ttlMs);
    try {
      const value = await pending;
      this.set(key, value, ttlMs);
      return value;
    } catch (error) {
      this.store.delete(key); // never cache failures
      throw error;
    }
  }

  get size() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }
}

module.exports = { TtlCache };
