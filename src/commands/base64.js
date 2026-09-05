'use strict';

const { SlashCommandBuilder } = require('discord.js');

const { createResultEmbed, codeBlock, EMOJI, COLORS } = require('../utils/embeds');
const { respond, fail } = require('../utils/respond');
const { requireString, ValidationError } = require('../utils/validation');
const { humanBytes } = require('../utils/format');

/** `/base64` — encode and decode Base64 / Base64URL. */

const VARIANTS = {
  base64: { label: 'Base64', encoding: 'base64' },
  base64url: { label: 'Base64URL', encoding: 'base64url' },
};

const FIELD_LIMIT = 1000;

/** Node's decoder is permissive, so we re-encode and compare to catch garbage. */
function decodeStrict(input, encoding) {
  const cleaned = input.replace(/\s+/g, '');
  if (!cleaned) throw new ValidationError('There was nothing to decode.');
  if (!/^[A-Za-z0-9+/_=-]*$/.test(cleaned)) {
    throw new ValidationError('That does not look like Base64.', {
      hint: 'Base64 only contains A–Z, a–z, 0–9, `+`, `/` and `=` (or `-` and `_` for Base64URL).',
    });
  }

  const buffer = Buffer.from(cleaned, encoding);
  const roundTrip = buffer.toString(encoding).replace(/=+$/, '');
  if (roundTrip !== cleaned.replace(/=+$/, '')) {
    throw new ValidationError('That Base64 string is malformed.', { hint: 'Check for missing characters or padding.' });
  }
  return buffer;
}

module.exports = {
  category: 'developer',
  rateLimit: 'default',

  data: new SlashCommandBuilder()
    .setName('base64')
    .setDescription('Encode and decode Base64.')
    .setDMPermission(true)
    .addSubcommand((sub) =>
      sub
        .setName('encode')
        .setDescription('Encode text to Base64.')
        .addStringOption((option) =>
          option.setName('text').setDescription('The text to encode').setRequired(true).setMaxLength(3000),
        )
        .addStringOption((option) =>
          option
            .setName('variant')
            .setDescription('Alphabet (default: standard Base64)')
            .addChoices({ name: 'Base64', value: 'base64' }, { name: 'Base64URL', value: 'base64url' }),
        )
        .addBooleanOption((option) => option.setName('private').setDescription('Only you can see the result')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('decode')
        .setDescription('Decode Base64 back to text.')
        .addStringOption((option) =>
          option.setName('data').setDescription('The Base64 to decode').setRequired(true).setMaxLength(4000),
        )
        .addStringOption((option) =>
          option
            .setName('variant')
            .setDescription('Alphabet (default: standard Base64)')
            .addChoices({ name: 'Base64', value: 'base64' }, { name: 'Base64URL', value: 'base64url' }),
        )
        .addBooleanOption((option) => option.setName('private').setDescription('Only you can see the result')),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const isPrivate = interaction.options.getBoolean('private') ?? false;
    const variant = VARIANTS[interaction.options.getString('variant') || 'base64'];

    try {
      if (sub === 'encode') {
        const text = requireString(interaction.options.getString('text'), 'text', { max: 3000, trim: false });
        const encoded = Buffer.from(text, 'utf8').toString(variant.encoding);

        return await respond(interaction, {
          ephemeral: isPrivate,
          embeds: [
            createResultEmbed({
              emoji: EMOJI.developer,
              title: `${variant.label} encoded`,
              color: COLORS.success,
              fields: [
                { name: 'Output', value: codeBlock(encoded, '', FIELD_LIMIT) },
                { name: 'Input', value: humanBytes(Buffer.byteLength(text, 'utf8')), inline: true },
                { name: 'Output size', value: humanBytes(encoded.length), inline: true },
              ],
              footer: encoded.length > FIELD_LIMIT ? 'Output was truncated to fit' : undefined,
            }),
          ],
        });
      }

      const data = requireString(interaction.options.getString('data'), 'data', { max: 4000 });
      const buffer = decodeStrict(data, variant.encoding);
      const decoded = buffer.toString('utf8');

      // Binary payloads decode to replacement characters; say so rather than
      // printing mojibake and pretending it worked.
      const looksBinary = decoded.includes('�');

      return await respond(interaction, {
        ephemeral: isPrivate,
        embeds: [
          createResultEmbed({
            emoji: EMOJI.developer,
            title: `${variant.label} decoded`,
            color: looksBinary ? COLORS.warning : COLORS.success,
            fields: [
              {
                name: 'Output',
                value: looksBinary
                  ? codeBlock(buffer.toString('hex').slice(0, 800), '', FIELD_LIMIT)
                  : codeBlock(decoded, '', FIELD_LIMIT),
              },
              { name: 'Bytes', value: humanBytes(buffer.length), inline: true },
              ...(looksBinary
                ? [{ name: `${EMOJI.warning} Not text`, value: 'The result is binary data, shown as hexadecimal.' }]
                : []),
            ],
          }),
        ],
      });
    } catch (error) {
      return fail(interaction, error);
    }
  },
};
