'use strict';

const { SlashCommandBuilder } = require('discord.js');

const { createResultEmbed, EMOJI, COLORS } = require('../utils/embeds');
const { respond, fail } = require('../utils/respond');
const { ValidationError } = require('../utils/validation');

/**
 * `/timestamp` — Discord's `<t:…>` markup.
 *
 * The whole point of these tags is that Discord renders them in each viewer's
 * own timezone, so the bot never has to guess where anybody is.
 */

const STYLES = [
  { code: 't', name: 'Short time', example: '16:20' },
  { code: 'T', name: 'Long time', example: '16:20:30' },
  { code: 'd', name: 'Short date', example: '20/04/2026' },
  { code: 'D', name: 'Long date', example: '20 April 2026' },
  { code: 'f', name: 'Short date/time', example: '20 April 2026 16:20' },
  { code: 'F', name: 'Long date/time', example: 'Monday, 20 April 2026 16:20' },
  { code: 'R', name: 'Relative', example: 'in 3 hours' },
];

/**
 * Parses `unix` / `date` options into a unix second value.
 * Accepts seconds, milliseconds, ISO 8601 and the common `YYYY-MM-DD HH:mm` shape.
 */
function resolveSeconds({ unix, date }) {
  if (unix !== null && unix !== undefined) {
    // Anything past year 10000 in seconds is almost certainly milliseconds.
    const seconds = Math.abs(unix) > 253402300799 ? Math.floor(unix / 1000) : unix;
    if (!Number.isFinite(seconds)) throw new ValidationError('That unix value is not a number.');
    if (seconds < -62135596800 || seconds > 253402300799) {
      throw new ValidationError('That timestamp is outside the range Discord can render (year 1 to 9999).');
    }
    return Math.floor(seconds);
  }

  if (date) {
    const text = String(date).trim();
    // `2026-04-20 16:20` is what people type; make it ISO before parsing.
    const normalised = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(text) ? text.replace(' ', 'T') : text;
    const parsed = Date.parse(normalised);
    if (Number.isNaN(parsed)) {
      throw new ValidationError(`\`${text}\` is not a date the doggy can read.`, {
        hint: 'Try `2026-04-20`, `2026-04-20 16:20` or a full ISO 8601 string.',
      });
    }
    return Math.floor(parsed / 1000);
  }

  throw new ValidationError('Give the doggy either a `unix` value or a `date`.');
}

function timestampEmbed(seconds, { title, note }) {
  return createResultEmbed({
    emoji: EMOJI.utilities,
    title,
    color: COLORS.brand,
    description: note,
    fields: [
      ...STYLES.map((style) => ({
        name: style.name,
        value: `<t:${seconds}:${style.code}>\n\`<t:${seconds}:${style.code}>\``,
        inline: true,
      })),
      { name: 'Unix seconds', value: `\`${seconds}\``, inline: true },
      { name: 'Unix milliseconds', value: `\`${seconds * 1000}\``, inline: true },
      { name: 'ISO 8601', value: `\`${new Date(seconds * 1000).toISOString()}\``, inline: false },
    ],
    footer: 'Everyone sees these in their own timezone',
  });
}

module.exports = {
  category: 'utilities',
  rateLimit: 'default',

  data: new SlashCommandBuilder()
    .setName('timestamp')
    .setDescription('Build Discord timestamps that render in everyone’s own timezone.')
    .setDMPermission(true)
    .addSubcommand((sub) =>
      sub
        .setName('now')
        .setDescription('Every timestamp style for right now.')
        .addBooleanOption((option) => option.setName('private').setDescription('Only you can see the result')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('at')
        .setDescription('Build a timestamp from a date or a unix value.')
        .addStringOption((option) =>
          option.setName('date').setDescription('e.g. 2026-04-20, 2026-04-20 16:20, or full ISO 8601').setMaxLength(64),
        )
        .addIntegerOption((option) =>
          option.setName('unix').setDescription('Unix time in seconds (milliseconds are detected automatically)'),
        )
        .addBooleanOption((option) => option.setName('private').setDescription('Only you can see the result')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('in')
        .setDescription('A timestamp a set amount of time from now.')
        .addIntegerOption((option) =>
          option.setName('amount').setDescription('How many units from now (negative for the past)').setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('unit')
            .setDescription('Unit of time')
            .setRequired(true)
            .addChoices(
              { name: 'minutes', value: '60' },
              { name: 'hours', value: '3600' },
              { name: 'days', value: '86400' },
              { name: 'weeks', value: '604800' },
            ),
        )
        .addBooleanOption((option) => option.setName('private').setDescription('Only you can see the result')),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const isPrivate = interaction.options.getBoolean('private') ?? false;

    try {
      if (sub === 'now') {
        const seconds = Math.floor(Date.now() / 1000);
        return await respond(interaction, {
          ephemeral: isPrivate,
          embeds: [timestampEmbed(seconds, { title: 'Timestamp — now', note: 'Copy any of the codes below into a message.' })],
        });
      }

      if (sub === 'in') {
        const amount = interaction.options.getInteger('amount');
        const unitSeconds = Number.parseInt(interaction.options.getString('unit'), 10);
        const seconds = Math.floor(Date.now() / 1000) + amount * unitSeconds;
        return await respond(interaction, {
          ephemeral: isPrivate,
          embeds: [timestampEmbed(seconds, { title: 'Timestamp', note: `Relative to when you ran this command.` })],
        });
      }

      const seconds = resolveSeconds({
        unix: interaction.options.getInteger('unix'),
        date: interaction.options.getString('date'),
      });
      return await respond(interaction, {
        ephemeral: isPrivate,
        embeds: [timestampEmbed(seconds, { title: 'Timestamp' })],
      });
    } catch (error) {
      return fail(interaction, error);
    }
  },

  resolveSeconds,
};
