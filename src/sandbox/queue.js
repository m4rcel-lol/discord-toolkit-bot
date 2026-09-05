'use strict';

const { logger } = require('../utils/logger');

/**
 * Bot-side backpressure in front of the sandbox worker.
 *
 * The worker enforces its own concurrency limit, but keeping a matching queue
 * here means we can fail fast with a friendly embed instead of holding a
 * Discord interaction open until it expires. A runaway program can therefore
 * never stall — let alone crash — the bot process.
 */
class SandboxQueue {
  constructor({ maxConcurrent = 4, maxQueueDepth = 24, queueTimeoutMs = 10000, name = 'luau' } = {}) {
    this.maxConcurrent = maxConcurrent;
    this.maxQueueDepth = maxQueueDepth;
    this.queueTimeoutMs = queueTimeoutMs;
    this.name = name;
    this.active = 0;
    this.waiting = [];
    this.stats = { submitted: 0, completed: 0, failed: 0, rejected: 0 };
  }

  /**
   * @param {() => Promise<any>} task
   * @returns {Promise<any>}
   */
  submit(task) {
    this.stats.submitted += 1;

    if (this.waiting.length >= this.maxQueueDepth) {
      this.stats.rejected += 1;
      const error = new Error('The sandbox queue is full.');
      error.code = 'QUEUE_FULL';
      error.userFacing = true;
      return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
      const entry = { task, resolve, reject, timer: null, queuedAt: Date.now() };
      entry.timer = setTimeout(() => {
        const index = this.waiting.indexOf(entry);
        if (index === -1) return;
        this.waiting.splice(index, 1);
        this.stats.rejected += 1;
        const error = new Error('Timed out waiting for a free sandbox.');
        error.code = 'QUEUE_TIMEOUT';
        error.userFacing = true;
        reject(error);
      }, this.queueTimeoutMs);

      this.waiting.push(entry);
      this.drain();
    });
  }

  drain() {
    while (this.active < this.maxConcurrent && this.waiting.length) {
      const entry = this.waiting.shift();
      clearTimeout(entry.timer);
      this.active += 1;

      Promise.resolve()
        .then(entry.task)
        .then(
          (value) => {
            this.stats.completed += 1;
            entry.resolve(value);
          },
          (error) => {
            this.stats.failed += 1;
            entry.reject(error);
          },
        )
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }

  shutdown() {
    const pending = this.waiting.splice(0);
    for (const entry of pending) {
      clearTimeout(entry.timer);
      const error = new Error('The bot is shutting down.');
      error.code = 'SHUTTING_DOWN';
      error.userFacing = true;
      entry.reject(error);
    }
    if (pending.length) logger.info('Sandbox queue drained on shutdown', { queue: this.name, dropped: pending.length });
  }

  snapshot() {
    return { active: this.active, waiting: this.waiting.length, ...this.stats };
  }
}

module.exports = { SandboxQueue };
