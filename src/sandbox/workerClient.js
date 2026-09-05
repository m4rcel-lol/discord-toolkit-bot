'use strict';

const { config } = require('../config');
const { logger } = require('../utils/logger');

/**
 * HTTP client for the Luau sandbox worker.
 *
 * The bot never executes user code itself — it hands the source to a separate
 * container over an internal-only docker network and waits for a verdict. The
 * request carries the shared worker token and nothing else; no Discord ids, no
 * usernames, no channel information ever leave the bot process.
 */

class WorkerError extends Error {
  constructor(message, { code = 'WORKER_ERROR', status, retryable = false } = {}) {
    super(message);
    this.name = 'WorkerError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.userFacing = true;
  }
}

/** Wall-clock allowance for the round trip: the sandbox limit plus slack. */
function requestTimeout() {
  return config.luau.timeoutMs + 8000;
}

async function post(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeout());

  let response;
  try {
    response = await fetch(`${config.luau.workerUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.luau.workerToken}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new WorkerError('The sandbox did not answer in time.', { code: 'WORKER_TIMEOUT', retryable: true });
    }
    logger.error('Luau worker unreachable', { path, error });
    throw new WorkerError('The Luau sandbox is unavailable right now.', { code: 'WORKER_UNREACHABLE', retryable: true });
  } finally {
    clearTimeout(timer);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new WorkerError('The sandbox returned an unreadable response.', { code: 'BAD_RESPONSE' });
  }

  if (response.status === 401) {
    logger.error('Luau worker rejected our token — check that LUAU_WORKER_TOKEN matches on both services');
    throw new WorkerError('The Luau sandbox rejected this bot. An operator needs to check the configuration.', {
      code: 'WORKER_UNAUTHORISED',
      status: 401,
    });
  }
  if (response.status === 503) {
    throw new WorkerError('The Luau sandbox is busy — try again in a few seconds.', {
      code: payload?.error || 'WORKER_BUSY',
      status: 503,
      retryable: true,
    });
  }
  if (!response.ok) {
    throw new WorkerError(payload?.message || 'The sandbox could not run that program.', {
      code: payload?.error || 'WORKER_ERROR',
      status: response.status,
    });
  }

  return payload;
}

async function runSource(source) {
  return post('/run', { source });
}

async function compileSource(source) {
  return post('/compile', { source });
}

/** Used by the startup self-check and `/toolkit` status. */
async function health({ timeoutMs = 3000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.luau.workerUrl}/health`, { signal: controller.signal });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, ...(await response.json()) };
  } catch (error) {
    return { ok: false, error: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { runSource, compileSource, health, WorkerError };
