'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { logger, registerSecret } = require('./utils/logger');

/**
 * Central configuration. Every knob comes from the environment so that the
 * bot can be deployed without touching a single source file.
 *
 * `loadDotEnv` is a very small .env reader — we deliberately avoid a dependency
 * for something this trivial, and in Docker the values arrive as real
 * environment variables anyway.
 */
function loadDotEnv(file = path.resolve(process.cwd(), '.env')) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return; // No .env file: perfectly normal in Docker.
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadDotEnv();

function str(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function int(name, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    logger.warn('Invalid integer in environment, using default', { name, fallback });
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function bool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

/** Parses "3/20" into { uses: 3, windowMs: 20000 }. */
function rate(name, fallbackUses, fallbackSeconds) {
  const raw = str(name);
  const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(raw);
  if (!match) return { uses: fallbackUses, windowMs: fallbackSeconds * 1000 };
  const uses = Math.max(1, Number.parseInt(match[1], 10));
  const seconds = Math.max(1, Number.parseInt(match[2], 10));
  return { uses, windowMs: seconds * 1000 };
}

const identifyBrowserRaw = str('DISCORD_IDENTIFY_BROWSER', 'Discord Android');
const identifyBrowser = ['Discord Android', 'Discord iOS'].includes(identifyBrowserRaw)
  ? identifyBrowserRaw
  : 'Discord Android';

const config = {
  discord: {
    token: str('DISCORD_TOKEN'),
    clientId: str('DISCORD_CLIENT_ID'),
    guildId: str('DISCORD_GUILD_ID'),
    identifyBrowser,
    userInstall: bool('DISCORD_USER_INSTALL', false),
    // Registering at startup means `docker compose up -d` is genuinely all
    // somebody needs to do. Set to false if you prefer `npm run deploy`.
    autoDeploy: bool('DISCORD_AUTO_DEPLOY', true),
  },
  luau: {
    // Hard bounds are applied here so that nobody can "configure away" the
    // safety limits by putting an absurd value in the environment.
    timeoutMs: int('LUAU_TIMEOUT_MS', 3000, { min: 250, max: 15000 }),
    memoryMb: int('LUAU_MEMORY_MB', 64, { min: 16, max: 512 }),
    maxOutput: int('LUAU_MAX_OUTPUT', 16000, { min: 256, max: 200000 }),
    maxSource: int('LUAU_MAX_SOURCE', 20000, { min: 128, max: 200000 }),
    maxConcurrent: int('LUAU_MAX_CONCURRENT', 4, { min: 1, max: 32 }),
    queueTimeoutMs: int('LUAU_QUEUE_TIMEOUT_MS', 10000, { min: 1000, max: 60000 }),
    workerUrl: str('LUAU_WORKER_URL', 'http://luau-worker:8080').replace(/\/+$/, ''),
    workerToken: str('LUAU_WORKER_TOKEN'),
  },
  wikipedia: {
    defaultLanguage: str('WIKIPEDIA_DEFAULT_LANGUAGE', 'en').toLowerCase(),
    contact: str('WIKIPEDIA_CONTACT', 'https://github.com/m5rcel/m5rcels-tool-doggy'),
    cacheTtlMs: int('WIKIPEDIA_CACHE_TTL_S', 300, { min: 0, max: 86400 }) * 1000,
  },
  rateLimits: {
    luau: rate('RATE_LIMIT_LUAU', 3, 20),
    qrDecode: rate('RATE_LIMIT_QR_DECODE', 5, 30),
    wiki: rate('RATE_LIMIT_WIKI', 10, 20),
    default: rate('RATE_LIMIT_DEFAULT', 20, 10),
  },
  log: {
    level: str('LOG_LEVEL', 'info'),
    format: str('LOG_FORMAT', 'json'),
  },
  branding: {
    name: "m5rcel's tool doggy",
    shortName: 'tool doggy',
    footer: "m5rcel's tool doggy",
    version: require('../package.json').version,
  },
};

// Make sure secrets can never leak through a log line, even accidentally.
registerSecret(config.discord.token);
registerSecret(config.luau.workerToken);
// Only override the logger when the operator actually asked for a level; the
// default already accounts for test runs.
if (process.env.LOG_LEVEL) logger.setLevel(config.log.level);

/**
 * Validates the configuration required for the given mode.
 * @param {'bot'|'deploy'} mode
 * @returns {string[]} human readable problems, empty when the config is usable
 */
function validateConfig(mode = 'bot') {
  const problems = [];
  if (!config.discord.token) problems.push('DISCORD_TOKEN is not set.');
  if (!config.discord.clientId) problems.push('DISCORD_CLIENT_ID is not set.');
  if (mode === 'bot') {
    if (!config.luau.workerToken) {
      problems.push('LUAU_WORKER_TOKEN is not set (the bot and the Luau worker must share one secret).');
    } else if (config.luau.workerToken === 'change-me-to-a-long-random-string') {
      problems.push('LUAU_WORKER_TOKEN still holds the example value — generate one with `openssl rand -hex 32`.');
    }
  }
  return problems;
}

module.exports = { config, validateConfig, loadDotEnv };
