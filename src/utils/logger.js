'use strict';

/**
 * Tiny dependency-free structured logger.
 *
 * Everything is emitted as one JSON object per line (or a coloured human
 * readable line when LOG_FORMAT=pretty), which keeps it friendly for
 * `docker compose logs` as well as for log shippers.
 *
 * Secrets are redacted defensively: any field whose key looks sensitive is
 * replaced, and any value containing a known secret is masked. User supplied
 * content (source code, message contents, uploaded files) must never be passed
 * to the logger in the first place — see the privacy notes in the README.
 */

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, silent: 100 };

const SENSITIVE_KEY = /(token|secret|password|passwd|authorization|auth|apikey|api_key|credential|cookie|session)/i;

/** Values registered here are masked anywhere they appear in a log line. */
const secrets = new Set();

function registerSecret(value) {
  if (typeof value === 'string' && value.length >= 8) secrets.add(value);
}

function maskSecrets(text) {
  let out = text;
  for (const secret of secrets) {
    if (out.includes(secret)) out = out.split(secret).join('[redacted]');
  }
  return out;
}

const MAX_DEPTH = 4;

function sanitize(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return maskSecrets(value.length > 2000 ? `${value.slice(0, 2000)}…` : value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: maskSecrets(String(value.message)),
      code: value.code,
      stack: value.stack ? maskSecrets(value.stack) : undefined,
      cause: value.cause instanceof Error ? sanitize(value.cause, depth + 1) : undefined,
    };
  }
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : sanitize(val, depth + 1);
    }
    return out;
  }
  return String(value);
}

const COLOURS = {
  trace: '\x1b[90m',
  debug: '\x1b[36m',
  info: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const RESET = '\x1b[0m';

class Logger {
  /**
   * @param {object} [options]
   * @param {string} [options.level]  minimum level to emit
   * @param {string} [options.format] "json" or "pretty"
   * @param {object} [options.bindings] fields merged into every line
   */
  constructor(options = {}) {
    this.level = LEVELS[String(options.level || 'info').toLowerCase()] ?? LEVELS.info;
    this.format = options.format === 'pretty' ? 'pretty' : 'json';
    this.bindings = options.bindings || {};
  }

  /** Returns a logger that stamps extra fields onto every line. */
  child(bindings) {
    const child = new Logger({ level: 'info', format: this.format, bindings: { ...this.bindings, ...bindings } });
    child.level = this.level;
    return child;
  }

  setLevel(level) {
    if (LEVELS[level] !== undefined) this.level = LEVELS[level];
  }

  write(level, message, fields) {
    if (LEVELS[level] < this.level) return;
    const payload = {
      time: new Date().toISOString(),
      level,
      msg: maskSecrets(String(message)),
      ...this.bindings,
      ...(fields ? sanitize(fields) : {}),
    };

    const line =
      this.format === 'pretty'
        ? `${COLOURS[level] || ''}${payload.time} ${level.toUpperCase().padEnd(5)}${RESET} ${payload.msg}` +
          formatExtras(payload)
        : safeStringify(payload);

    if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  }

  trace(msg, fields) { this.write('trace', msg, fields); }
  debug(msg, fields) { this.write('debug', msg, fields); }
  info(msg, fields) { this.write('info', msg, fields); }
  warn(msg, fields) { this.write('warn', msg, fields); }
  error(msg, fields) { this.write('error', msg, fields); }
}

function formatExtras(payload) {
  const extras = { ...payload };
  delete extras.time;
  delete extras.level;
  delete extras.msg;
  const keys = Object.keys(extras);
  if (keys.length === 0) return '';
  return ` \x1b[90m${keys.map((k) => `${k}=${inlineValue(extras[k])}`).join(' ')}${RESET}`;
}

function inlineValue(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'object') return safeStringify(value);
  return String(value);
}

function safeStringify(value) {
  try {
    return JSON.stringify(value, (key, val) => (typeof val === 'bigint' ? val.toString() : val));
  } catch {
    return JSON.stringify({ msg: '[unserialisable log payload]' });
  }
}

/**
 * Under `node --test` the default level is `silent`, so a failing assertion is
 * not buried in the bot's own (correct, expected) log output. Setting LOG_LEVEL
 * explicitly still wins, so `LOG_LEVEL=debug npm test` works when diagnosing.
 */
const isTestRun = process.execArgv.includes('--test') || process.env.NODE_ENV === 'test';

const logger = new Logger({
  level: process.env.LOG_LEVEL || (isTestRun ? 'silent' : 'info'),
  format: process.env.LOG_FORMAT,
});

module.exports = { logger, Logger, registerSecret, LEVELS };
