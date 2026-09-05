'use strict';

const { EmbedBuilder } = require('discord.js');
const { config } = require('../config');

/**
 * The one and only place where embeds are styled. Commands describe *what*
 * they want to say; this module decides how the bot looks while saying it.
 */

const COLORS = {
  brand: 0xff8a3d,
  success: 0x4ade80,
  error: 0xf87171,
  warning: 0xfbbf24,
  info: 0x60a5fa,
  loading: 0xa78bfa,
  neutral: 0x2b2d31,
};

const EMOJI = {
  dog: '🐶',
  toolkit: '🧰',
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
  loading: '⏳',
  timer: '⏱️',
  green: '🟢',
  red: '🔴',
  yellow: '🟡',
  developer: '💻',
  calculator: '🧮',
  colors: '🎨',
  qr: '▣',
  wiki: '📚',
  utilities: '🔧',
};

// Discord's hard limits. Everything we build is clamped to these so a huge
// result can never turn into a 400 from the API.
const LIMITS = {
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  fields: 25,
  total: 6000,
};

/** Truncates `text` to `max` characters, appending an ellipsis when cut. */
function truncate(text, max) {
  const value = String(text ?? '');
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Wraps text in a fenced code block, trimming the content (not the fence)
 * so the result always fits inside `max` characters.
 */
function codeBlock(text, language = '', max = LIMITS.fieldValue) {
  const fence = '```';
  const overhead = fence.length * 2 + language.length + 2;
  const body = String(text ?? '');
  const room = Math.max(0, max - overhead);
  const trimmed = body.length > room ? `${body.slice(0, Math.max(0, room - 1))}…` : body;
  // An empty code block renders badly; a single space keeps it visible.
  return `${fence}${language}\n${trimmed.length ? trimmed : ' '}\n${fence}`;
}

/** Escapes Discord markdown so user content cannot break the layout. */
function escapeMarkdown(text) {
  return String(text ?? '').replace(/([\\`*_~|>[\]()#-])/g, '\\$1');
}

function baseEmbed({ color, title, description, fields, footer, thumbnail, image, url, author }) {
  const embed = new EmbedBuilder()
    .setColor(color ?? COLORS.brand)
    .setTimestamp(new Date())
    .setFooter({ text: truncate(footer ? `${config.branding.footer} • ${footer}` : config.branding.footer, LIMITS.footer) });

  if (title) embed.setTitle(truncate(title, LIMITS.title));
  if (description) embed.setDescription(truncate(description, LIMITS.description));
  if (url) embed.setURL(url);
  if (author) embed.setAuthor(author);
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (image) embed.setImage(image);
  if (Array.isArray(fields) && fields.length) embed.addFields(normaliseFields(fields));
  return embed;
}

/** Clamps a field list to Discord's limits and drops empty entries. */
function normaliseFields(fields) {
  return fields
    .filter((field) => field && field.name !== undefined && field.value !== undefined && field.value !== '')
    .slice(0, LIMITS.fields)
    .map((field) => ({
      name: truncate(field.name, LIMITS.fieldName),
      value: truncate(field.value, LIMITS.fieldValue),
      inline: Boolean(field.inline),
    }));
}

function createSuccessEmbed({ title = 'Done', description, fields, footer, ...rest } = {}) {
  return baseEmbed({ color: COLORS.success, title: `${EMOJI.success} ${title}`, description, fields, footer, ...rest });
}

function createErrorEmbed({ title = 'Something went wrong', description, fields, footer, ...rest } = {}) {
  return baseEmbed({
    color: COLORS.error,
    title: `${EMOJI.error} ${title}`,
    description: description || `${config.branding.name} couldn't complete that request.\nPlease try again later.`,
    fields,
    footer,
    ...rest,
  });
}

function createWarningEmbed({ title = 'Heads up', description, fields, footer, ...rest } = {}) {
  return baseEmbed({ color: COLORS.warning, title: `${EMOJI.warning} ${title}`, description, fields, footer, ...rest });
}

function createInfoEmbed({ title, description, fields, footer, ...rest } = {}) {
  return baseEmbed({ color: COLORS.info, title, description, fields, footer, ...rest });
}

function createLoadingEmbed({ title = 'Working on it', description = 'The doggy is fetching that for you…', ...rest } = {}) {
  return baseEmbed({ color: COLORS.loading, title: `${EMOJI.loading} ${title}`, description, ...rest });
}

/**
 * The workhorse for command output: a branded, neutral-coloured result card.
 * @param {object} options
 * @param {string} options.emoji  category emoji, e.g. EMOJI.colors
 * @param {string} options.title  short title without the emoji
 */
function createResultEmbed({ emoji = EMOJI.toolkit, title = 'Result', color = COLORS.brand, ...rest } = {}) {
  return baseEmbed({ color, title: `${emoji} ${title}`, ...rest });
}

/** Rate-limit notice — friendly, never scary. */
function createRateLimitEmbed(retryAfterMs, what = 'that') {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return baseEmbed({
    color: COLORS.warning,
    title: `${EMOJI.dog} Slow down!`,
    description: `You can use ${what} again in **${seconds} second${seconds === 1 ? '' : 's'}**.`,
    footer: 'Rate limit',
  });
}

module.exports = {
  COLORS,
  EMOJI,
  LIMITS,
  truncate,
  codeBlock,
  escapeMarkdown,
  createSuccessEmbed,
  createErrorEmbed,
  createWarningEmbed,
  createInfoEmbed,
  createLoadingEmbed,
  createResultEmbed,
  createRateLimitEmbed,
};
