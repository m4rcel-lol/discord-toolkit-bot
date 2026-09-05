'use strict';

/**
 * Input validation helpers. Every command runs its user input through these
 * before touching a service, so services can assume well-formed arguments.
 */

class ValidationError extends Error {
  constructor(message, { hint } = {}) {
    super(message);
    this.name = 'ValidationError';
    this.hint = hint;
    this.userFacing = true;
  }
}

/** Strips a surrounding ```lang fenced block (or single backticks). */
function stripCodeFence(input) {
  const text = String(input ?? '');
  const fenced = /^\s*```([a-zA-Z0-9+#._-]*)\r?\n([\s\S]*?)\r?\n?```\s*$/.exec(text);
  if (fenced) return fenced[2];
  const inline = /^\s*`([^`]*)`\s*$/.exec(text);
  if (inline) return inline[1];
  return text;
}

/**
 * Discord options arrive as a single line, so users type `\n` for newlines.
 * Turn the common escapes into real characters, leaving everything else alone.
 */
function expandEscapes(input) {
  return String(input ?? '').replace(/\\([nrt\\])/g, (match, char) => {
    if (char === 'n') return '\n';
    if (char === 'r') return '\r';
    if (char === 't') return '\t';
    return '\\';
  });
}

function requireString(value, name, { min = 1, max = 4000, trim = true } = {}) {
  if (typeof value !== 'string') throw new ValidationError(`\`${name}\` must be text.`);
  const text = trim ? value.trim() : value;
  if (text.length < min) throw new ValidationError(`\`${name}\` must be at least ${min} character${min === 1 ? '' : 's'} long.`);
  if (text.length > max) {
    throw new ValidationError(`\`${name}\` is too long (${text.length} characters, maximum is ${max}).`);
  }
  return text;
}

/** Byte length rather than code-point length — matters for size limits. */
function byteLength(text) {
  return Buffer.byteLength(String(text ?? ''), 'utf8');
}

const SAFE_LANGUAGE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i;

/** Validates a Wikipedia language code such as `en`, `pl`, `zh-yue`. */
function requireLanguage(value, fallback = 'en') {
  if (value === undefined || value === null || value === '') return fallback;
  const code = String(value).trim().toLowerCase();
  if (!SAFE_LANGUAGE.test(code)) {
    throw new ValidationError(`\`${code}\` is not a valid Wikipedia language code.`, {
      hint: 'Use a code like `en`, `de`, `pl` or `zh`.',
    });
  }
  return code;
}

/** Only http(s), and never a bare/loopback/private host for user-supplied URLs. */
function requireHttpUrl(value, name = 'url') {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new ValidationError(`\`${name}\` is not a valid URL.`, { hint: 'Include the scheme, e.g. `https://example.com`.' });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError(`\`${name}\` must be an http or https URL.`);
  }
  return url;
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[?::1\]?|172\.(1[6-9]|2\d|3[01])\.)/i;

/** Guards outbound fetches (e.g. attachment downloads) against SSRF. */
function assertPublicUrl(url, name = 'url') {
  const parsed = url instanceof URL ? url : requireHttpUrl(url, name);
  if (PRIVATE_HOST.test(parsed.hostname)) {
    throw new ValidationError('That address points at a private network, so the doggy will not fetch it.');
  }
  return parsed;
}

function requireInteger(value, name, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new ValidationError(`\`${name}\` must be a whole number.`);
  }
  if (parsed < min || parsed > max) {
    throw new ValidationError(`\`${name}\` must be between ${min} and ${max}.`);
  }
  return parsed;
}

module.exports = {
  ValidationError,
  stripCodeFence,
  expandEscapes,
  requireString,
  requireLanguage,
  requireHttpUrl,
  assertPublicUrl,
  requireInteger,
  byteLength,
};
