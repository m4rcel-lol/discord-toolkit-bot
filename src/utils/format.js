'use strict';

/** Presentation helpers shared by the command layer. */

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

function humanBytes(bytes) {
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? value : Math.round(value * 100) / 100;
  return `${rounded} ${UNITS[unit]}`;
}

function humanDuration(ms) {
  const value = Number(ms) || 0;
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60000) return `${(value / 1000).toFixed(2)} s`;
  const minutes = Math.floor(value / 60000);
  const seconds = Math.round((value % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Groups a number with thin spaces (U+2009) so long integers stay readable.
 * `\s` matches U+2009, so a grouped number pasted back into /calc still parses.
 */
const THIN_SPACE = '\u2009';

function groupDigits(text) {
  const [intPart, fracPart] = String(text).split('.');
  const sign = intPart.startsWith('-') ? '-' : '';
  const digits = sign ? intPart.slice(1) : intPart;
  if (digits.length <= 4) return String(text);
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
  return fracPart === undefined ? `${sign}${grouped}` : `${sign}${grouped}.${fracPart}`;
}

/** Splits long text into chunks that fit in a Discord field/description. */
function chunk(text, size) {
  const out = [];
  const value = String(text ?? '');
  for (let i = 0; i < value.length; i += size) out.push(value.slice(i, i + size));
  return out.length ? out : [''];
}

/** Where the interaction happened, for logs and for context-aware copy. */
function describeContext(interaction) {
  if (interaction.inGuild()) return 'guild';
  if (interaction.channel && interaction.channel.type === 3) return 'group-dm';
  return 'dm';
}

module.exports = { humanBytes, humanDuration, groupDigits, chunk, describeContext };
