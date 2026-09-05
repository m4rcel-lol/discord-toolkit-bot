'use strict';

const { config } = require('../config');
const { humanBytes, humanDuration } = require('../utils/format');

/**
 * The limits the bot advertises to users. They mirror what the worker actually
 * enforces (the worker clamps them again on its side — a user can never widen
 * a limit, only the operator can, and only within the hard bounds in
 * `worker/src/limits.js`).
 */
const limits = config.luau;

function describeLimits() {
  return [
    { name: 'Time', value: humanDuration(limits.timeoutMs), inline: true },
    { name: 'Memory', value: `${limits.memoryMb} MiB`, inline: true },
    { name: 'Output', value: humanBytes(limits.maxOutput), inline: true },
    { name: 'Source', value: humanBytes(limits.maxSource), inline: true },
    { name: 'Concurrency', value: `${limits.maxConcurrent} program${limits.maxConcurrent === 1 ? '' : 's'}`, inline: true },
    { name: 'Network', value: 'None', inline: true },
  ];
}

function summaryLine() {
  return `${humanDuration(limits.timeoutMs)} · ${limits.memoryMb} MiB · no network · no filesystem`;
}

module.exports = { limits, describeLimits, summaryLine };
