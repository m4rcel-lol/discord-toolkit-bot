'use strict';

const { config } = require('../../config');
const { logger } = require('../../utils/logger');
const { SandboxQueue } = require('../../sandbox/queue');
const workerClient = require('../../sandbox/workerClient');
const { limits } = require('../../sandbox/limits');
const { ValidationError, stripCodeFence, byteLength } = require('../../utils/validation');

/**
 * The bot's Luau facade.
 *
 * Responsibilities: validate the submitted source, apply backpressure, hand
 * the work to the isolated worker, and normalise whatever comes back into one
 * predictable shape for the command layer. User source code is never logged.
 */

const queue = new SandboxQueue({
  maxConcurrent: limits.maxConcurrent,
  maxQueueDepth: Math.max(8, limits.maxConcurrent * 6),
  queueTimeoutMs: limits.queueTimeoutMs,
  name: 'luau',
});

/**
 * Normalises user input into runnable source.
 * @throws {ValidationError}
 */
function prepareSource(input) {
  const source = stripCodeFence(String(input ?? '')).replace(/\r\n/g, '\n').trim();
  if (!source) {
    throw new ValidationError('There was no Luau code to run.', { hint: 'Paste some code, or wrap it in a ```lua block.' });
  }
  const bytes = byteLength(source);
  if (bytes > limits.maxSource) {
    throw new ValidationError(
      `That program is ${bytes} bytes — the limit is ${limits.maxSource} bytes.`,
      { hint: 'Trim it down, or split it into smaller pieces.' },
    );
  }
  return source;
}

async function execute(kind, input, context = {}) {
  const source = prepareSource(input);
  const startedAt = Date.now();

  const payload = await queue.submit(() =>
    kind === 'compile' ? workerClient.compileSource(source) : workerClient.runSource(source),
  );

  // Log the shape of the job, never its contents.
  logger.info('Luau job complete', {
    kind,
    status: payload.status,
    bytes: byteLength(source),
    sandboxMs: payload.durationMs,
    totalMs: Date.now() - startedAt,
    waitedMs: payload.waitedMs,
    guildId: context.guildId || null,
  });

  return { ...payload, kind, sourceBytes: byteLength(source), sourceLines: source.split('\n').length, totalMs: Date.now() - startedAt };
}

/** Runs a Luau program in the sandbox. */
function run(source, context) {
  return execute('run', source, context);
}

/** Syntax- and type-checks a Luau program without running it. */
function compile(source, context) {
  return execute('compile', source, context);
}

function stats() {
  return { queue: queue.snapshot(), limits: { ...config.luau, workerToken: undefined } };
}

function shutdown() {
  queue.shutdown();
}

module.exports = { run, compile, prepareSource, stats, shutdown, queue, health: workerClient.health };
