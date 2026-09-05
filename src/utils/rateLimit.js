'use strict';

/**
 * Per-user sliding-window rate limiter.
 *
 * Deliberately in-memory: the bot is a single process, the limits are short,
 * and losing the counters on restart is harmless. Buckets are swept
 * periodically so a busy public bot cannot leak memory through the map.
 */

class RateLimiter {
  /**
   * @param {object} options
   * @param {number} options.uses     allowed uses per window
   * @param {number} options.windowMs window length in milliseconds
   * @param {string} [options.name]   used in log lines / error copy
   */
  constructor({ uses, windowMs, name = 'default' }) {
    this.uses = Math.max(1, uses);
    this.windowMs = Math.max(1, windowMs);
    this.name = name;
    /** @type {Map<string, number[]>} key -> sorted timestamps */
    this.hits = new Map();
    this.lastSweep = 0;
  }

  /**
   * Records an attempt.
   * @param {string} key usually the Discord user id
   * @returns {{ allowed: boolean, retryAfterMs: number, remaining: number }}
   */
  consume(key) {
    const now = Date.now();
    this.maybeSweep(now);

    const cutoff = now - this.windowMs;
    const timestamps = (this.hits.get(key) || []).filter((ts) => ts > cutoff);

    if (timestamps.length >= this.uses) {
      const retryAfterMs = Math.max(0, timestamps[0] + this.windowMs - now);
      this.hits.set(key, timestamps);
      return { allowed: false, retryAfterMs, remaining: 0 };
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);
    return { allowed: true, retryAfterMs: 0, remaining: this.uses - timestamps.length };
  }

  /** Gives a consumed slot back, e.g. when the work was never actually done. */
  refund(key) {
    const timestamps = this.hits.get(key);
    if (timestamps && timestamps.length) {
      timestamps.pop();
      if (timestamps.length === 0) this.hits.delete(key);
    }
  }

  /** Drops expired buckets. Cheap, and at most once per window. */
  maybeSweep(now = Date.now()) {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    const cutoff = now - this.windowMs;
    for (const [key, timestamps] of this.hits) {
      const kept = timestamps.filter((ts) => ts > cutoff);
      if (kept.length === 0) this.hits.delete(key);
      else this.hits.set(key, kept);
    }
  }

  clear() {
    this.hits.clear();
  }
}

/** Named limiter registry so commands can just ask for the bucket they need. */
class RateLimiterRegistry {
  constructor() {
    this.limiters = new Map();
  }

  register(name, { uses, windowMs }) {
    this.limiters.set(name, new RateLimiter({ uses, windowMs, name }));
    return this.limiters.get(name);
  }

  get(name) {
    return this.limiters.get(name) || this.limiters.get('default');
  }

  /**
   * @returns {{ allowed: boolean, retryAfterMs: number, remaining: number }}
   */
  consume(name, key) {
    const limiter = this.get(name);
    if (!limiter) return { allowed: true, retryAfterMs: 0, remaining: Infinity };
    return limiter.consume(key);
  }

  refund(name, key) {
    const limiter = this.get(name);
    if (limiter) limiter.refund(key);
  }

  clear() {
    for (const limiter of this.limiters.values()) limiter.clear();
  }
}

module.exports = { RateLimiter, RateLimiterRegistry };
