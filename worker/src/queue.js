'use strict';

/**
 * Bounded concurrency queue.
 *
 * Guarantees, in order of importance:
 *   - never more than `maxConcurrent` sandboxes alive at once;
 *   - never more than `maxQueueDepth` jobs waiting (new ones are rejected
 *     immediately rather than piling up);
 *   - a job that waits longer than `queueTimeoutMs` is dropped before it ever
 *     starts, so a Discord interaction cannot expire while the queue drains.
 */
class ExecutionQueue {
  constructor({ maxConcurrent = 4, maxQueueDepth = 32, queueTimeoutMs = 10000 } = {}) {
    this.maxConcurrent = maxConcurrent;
    this.maxQueueDepth = maxQueueDepth;
    this.queueTimeoutMs = queueTimeoutMs;
    this.active = 0;
    /** @type {Array<{ task: Function, resolve: Function, reject: Function, timer: NodeJS.Timeout, queuedAt: number }>} */
    this.waiting = [];
    this.stats = { accepted: 0, completed: 0, failed: 0, rejected: 0, timedOutInQueue: 0 };
  }

  get depth() {
    return this.waiting.length;
  }

  /**
   * @param {() => Promise<any>} task
   * @returns {Promise<{ result: any, waitedMs: number }>}
   */
  push(task) {
    if (this.waiting.length >= this.maxQueueDepth) {
      this.stats.rejected += 1;
      const error = new Error('The sandbox queue is full.');
      error.code = 'QUEUE_FULL';
      return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
      const entry = { task, resolve, reject, queuedAt: Date.now(), timer: null };

      entry.timer = setTimeout(() => {
        const index = this.waiting.indexOf(entry);
        if (index !== -1) {
          this.waiting.splice(index, 1);
          this.stats.timedOutInQueue += 1;
          const error = new Error('Timed out waiting for a free sandbox.');
          error.code = 'QUEUE_TIMEOUT';
          reject(error);
        }
      }, this.queueTimeoutMs);

      this.waiting.push(entry);
      this.stats.accepted += 1;
      this.drain();
    });
  }

  drain() {
    while (this.active < this.maxConcurrent && this.waiting.length) {
      const entry = this.waiting.shift();
      clearTimeout(entry.timer);
      this.active += 1;
      const waitedMs = Date.now() - entry.queuedAt;

      Promise.resolve()
        .then(entry.task)
        .then(
          (result) => {
            this.stats.completed += 1;
            entry.resolve({ result, waitedMs });
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

  /** Rejects everything still waiting — used during shutdown. */
  drainForShutdown() {
    for (const entry of this.waiting.splice(0)) {
      clearTimeout(entry.timer);
      const error = new Error('The sandbox is shutting down.');
      error.code = 'SHUTTING_DOWN';
      entry.reject(error);
    }
  }

  snapshot() {
    return { active: this.active, waiting: this.waiting.length, maxConcurrent: this.maxConcurrent, ...this.stats };
  }
}

module.exports = { ExecutionQueue };
