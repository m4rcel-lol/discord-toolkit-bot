'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { uuidV7 } = require('../src/commands/uuid');
const { resolveSeconds } = require('../src/commands/timestamp');
const { Logger, registerSecret } = require('../src/utils/logger');
const { ValidationError } = require('../src/utils/validation');

test('UUIDv7 is well formed, time ordered and unique', () => {
  const uuid = uuidV7();
  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  const batch = Array.from({ length: 500 }, () => uuidV7());
  assert.equal(new Set(batch).size, 500, 'no collisions');

  const sorted = [...batch].sort();
  assert.equal(sorted[0].slice(0, 8), batch[0].slice(0, 8), 'the timestamp prefix keeps them ordered');
});

test('timestamps accept seconds, milliseconds and dates', () => {
  assert.equal(resolveSeconds({ unix: 1700000000 }), 1700000000);
  assert.equal(resolveSeconds({ unix: 1700000000000 }), 1700000000, 'milliseconds are detected');
  assert.equal(resolveSeconds({ date: '2026-04-20T00:00:00Z' }), 1776643200);
  assert.equal(resolveSeconds({ date: '2026-04-20' }), 1776643200);

  assert.throws(() => resolveSeconds({}), ValidationError);
  assert.throws(() => resolveSeconds({ date: 'yesterday-ish' }), ValidationError);
  assert.throws(() => resolveSeconds({ date: '' }), ValidationError);

  // Past year 9999 Discord cannot render the tag, so it is rejected outright.
  assert.throws(() => resolveSeconds({ unix: 999999999999999999 }), ValidationError);
  assert.equal(resolveSeconds({ unix: 253402300799 }), 253402300799, 'the last renderable second is allowed');
});

/** Captures everything a logger writes, so redaction can be asserted. */
function captureLogger(fields) {
  const lines = [];
  const logger = new Logger({ level: 'trace', format: 'json' });
  const original = { out: process.stdout.write, err: process.stderr.write };
  process.stdout.write = (line) => { lines.push(line); return true; };
  process.stderr.write = (line) => { lines.push(line); return true; };
  try {
    logger.info('test', fields);
  } finally {
    process.stdout.write = original.out;
    process.stderr.write = original.err;
  }
  return lines.join('');
}

test('the logger redacts anything that looks like a secret', () => {
  const output = captureLogger({
    token: 'super-secret-token',
    apiKey: 'abc123',
    Authorization: 'Bearer xyz',
    password: 'hunter2',
    nested: { sessionToken: 'nope' },
    safe: 'visible',
  });

  assert.doesNotMatch(output, /super-secret-token|abc123|Bearer xyz|hunter2|nope/);
  assert.match(output, /\[redacted\]/);
  assert.match(output, /visible/);
});

test('registered secrets are masked wherever they appear', () => {
  registerSecret('MzQ1Njc4OTAxMjM0NTY3ODkw.fake.token');
  const output = captureLogger({ message: 'connecting with MzQ1Njc4OTAxMjM0NTY3ODkw.fake.token now' });
  assert.doesNotMatch(output, /MzQ1Njc4OTAxMjM0NTY3ODkw/);
  assert.match(output, /\[redacted\]/);
});

test('the logger survives circular and exotic values', () => {
  const circular = { name: 'loop' };
  circular.self = circular;
  const output = captureLogger({ circular, big: 10n, error: new Error('boom'), list: [1, 2, 3] });
  assert.match(output, /loop/);
  assert.match(output, /boom/);
  assert.ok(output.endsWith('\n'));
});

test('log levels are respected', () => {
  const lines = [];
  const logger = new Logger({ level: 'warn', format: 'json' });
  const original = process.stdout.write;
  const originalErr = process.stderr.write;
  process.stdout.write = (line) => { lines.push(line); return true; };
  process.stderr.write = (line) => { lines.push(line); return true; };
  try {
    logger.debug('hidden');
    logger.info('hidden');
    logger.warn('shown');
    logger.error('shown too');
  } finally {
    process.stdout.write = original;
    process.stderr.write = originalErr;
  }
  assert.equal(lines.length, 2);
  assert.doesNotMatch(lines.join(''), /hidden/);
});
