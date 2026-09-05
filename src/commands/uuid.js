'use strict';

const crypto = require('node:crypto');
const { SlashCommandBuilder } = require('discord.js');

const { createResultEmbed, codeBlock, EMOJI, COLORS } = require('../utils/embeds');
const { respond, fail } = require('../utils/respond');

/** `/uuid` — cryptographically random identifiers. */

/**
 * UUIDv7: a 48-bit big-endian millisecond timestamp followed by 74 random
 * bits, per RFC 9562. Sorts by creation time, which is what people actually
 * want from a database key.
 */
function uuidV7() {
  const bytes = crypto.randomBytes(16);
  const timestamp = BigInt(Date.now());

  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);

  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 9562 variant

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const GENERATORS = {
  v4: { label: 'UUIDv4', description: '122 random bits. The everyday choice.', generate: () => crypto.randomUUID() },
  v7: { label: 'UUIDv7', description: 'Time-ordered, so it indexes well in a database.', generate: uuidV7 },
  nil: { label: 'Nil UUID', description: 'All zeroes — the "no value" UUID.', generate: () => '00000000-0000-0000-0000-000000000000' },
  short: {
    label: 'Short ID',
    description: '22 characters of Base64URL — 128 bits, but compact.',
    generate: () => crypto.randomBytes(16).toString('base64url'),
  },
};

module.exports = {
  category: 'utilities',
  rateLimit: 'default',

  data: new SlashCommandBuilder()
    .setName('uuid')
    .setDescription('Generate cryptographically random identifiers.')
    .setDMPermission(true)
    .addStringOption((option) =>
      option
        .setName('version')
        .setDescription('Which flavour (default: v4)')
        .addChoices(
          { name: 'UUIDv4 — random (default)', value: 'v4' },
          { name: 'UUIDv7 — time-ordered', value: 'v7' },
          { name: 'Short ID — Base64URL', value: 'short' },
          { name: 'Nil UUID — all zeroes', value: 'nil' },
        ),
    )
    .addIntegerOption((option) =>
      option.setName('count').setDescription('How many to generate (1–20, default 1)').setMinValue(1).setMaxValue(20),
    )
    .addBooleanOption((option) => option.setName('uppercase').setDescription('Return them in upper case'))
    .addBooleanOption((option) => option.setName('private').setDescription('Only you can see the result')),

  async execute(interaction) {
    const isPrivate = interaction.options.getBoolean('private') ?? false;

    try {
      const generator = GENERATORS[interaction.options.getString('version') || 'v4'];
      const count = interaction.options.getInteger('count') ?? 1;
      const uppercase = interaction.options.getBoolean('uppercase') ?? false;

      const values = Array.from({ length: count }, () => {
        const value = generator.generate();
        return uppercase ? value.toUpperCase() : value;
      });

      return await respond(interaction, {
        ephemeral: isPrivate,
        embeds: [
          createResultEmbed({
            emoji: EMOJI.utilities,
            title: count === 1 ? generator.label : `${count} × ${generator.label}`,
            color: COLORS.brand,
            description: generator.description,
            fields: [{ name: count === 1 ? 'Identifier' : 'Identifiers', value: codeBlock(values.join('\n'), '') }],
            footer: 'Generated with crypto.randomBytes',
          }),
        ],
      });
    } catch (error) {
      return fail(interaction, error);
    }
  },

  uuidV7,
};
