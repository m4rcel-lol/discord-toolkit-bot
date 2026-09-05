'use strict';

const crypto = require('node:crypto');
const { SlashCommandBuilder } = require('discord.js');

const { createResultEmbed, EMOJI, COLORS, truncate } = require('../utils/embeds');
const { respond, fail } = require('../utils/respond');
const { requireString } = require('../utils/validation');
const { humanBytes } = require('../utils/format');

/**
 * `/hash` — cryptographic digests.
 *
 * MD5 and SHA-1 are offered because people genuinely need them for checksums
 * and legacy systems, but every response says plainly that they are broken for
 * anything security-sensitive.
 */

const ALGORITHMS = {
  sha256: { label: 'SHA-256', node: 'sha256', safe: true, note: 'The sensible default for integrity checks.' },
  sha512: { label: 'SHA-512', node: 'sha512', safe: true, note: 'Wider digest, same SHA-2 family.' },
  sha384: { label: 'SHA-384', node: 'sha384', safe: true, note: 'Truncated SHA-512.' },
  sha224: { label: 'SHA-224', node: 'sha224', safe: true, note: 'Truncated SHA-256.' },
  sha3_256: { label: 'SHA3-256', node: 'sha3-256', safe: true, note: 'Keccak-based, different design to SHA-2.' },
  sha3_512: { label: 'SHA3-512', node: 'sha3-512', safe: true, note: 'Keccak-based, wider digest.' },
  sha1: {
    label: 'SHA-1',
    node: 'sha1',
    safe: false,
    note: 'Collisions are practical. Fine as a checksum, never for security.',
  },
  md5: {
    label: 'MD5',
    node: 'md5',
    safe: false,
    note: 'Broken since 2004. Fine as a checksum, never for security.',
  },
};

const CHOICES = Object.entries(ALGORITHMS).map(([value, algorithm]) => ({
  name: `${algorithm.label}${algorithm.safe ? '' : ' — not for security'}`,
  value,
}));

module.exports = {
  category: 'developer',
  rateLimit: 'default',

  data: new SlashCommandBuilder()
    .setName('hash')
    .setDescription('Hash text with SHA-256, SHA-512, SHA-1, MD5 and more.')
    .setDMPermission(true)
    .addStringOption((option) =>
      option.setName('text').setDescription('The text to hash').setRequired(true).setMaxLength(4000),
    )
    .addStringOption((option) =>
      option
        .setName('algorithm')
        .setDescription('Which digest to use (default: SHA-256)')
        .addChoices(...CHOICES),
    )
    .addStringOption((option) =>
      option
        .setName('encoding')
        .setDescription('Output encoding (default: hex)')
        .addChoices(
          { name: 'Hexadecimal', value: 'hex' },
          { name: 'Base64', value: 'base64' },
          { name: 'Base64URL', value: 'base64url' },
        ),
    )
    .addBooleanOption((option) =>
      option.setName('private').setDescription('Only you can see the result (default: true)'),
    ),

  async execute(interaction) {
    // Hashing usually means a password or a secret, so it stays private
    // unless the user deliberately asks for a public reply.
    const isPrivate = interaction.options.getBoolean('private') ?? true;

    try {
      const text = requireString(interaction.options.getString('text'), 'text', { max: 4000, trim: false });
      const key = interaction.options.getString('algorithm') || 'sha256';
      const encoding = interaction.options.getString('encoding') || 'hex';
      const algorithm = ALGORITHMS[key];

      const digest = crypto.createHash(algorithm.node).update(text, 'utf8').digest(encoding);

      const fields = [
        { name: `${algorithm.label} (${encoding})`, value: `\`\`\`\n${truncate(digest, 900)}\n\`\`\`` },
        { name: 'Input', value: `${text.length} characters · ${humanBytes(Buffer.byteLength(text, 'utf8'))}`, inline: true },
        { name: 'Digest', value: `${digest.length} characters`, inline: true },
      ];

      if (!algorithm.safe) {
        fields.push({
          name: `${EMOJI.warning} Not for security`,
          value: `${algorithm.note}\nUse **SHA-256** or better when it matters.`,
        });
      }

      return await respond(interaction, {
        ephemeral: isPrivate,
        embeds: [
          createResultEmbed({
            emoji: EMOJI.developer,
            title: `${algorithm.label} hash`,
            color: algorithm.safe ? COLORS.success : COLORS.warning,
            description: algorithm.note,
            fields,
            footer: algorithm.safe ? undefined : 'Legacy algorithm',
          }),
        ],
      });
    } catch (error) {
      return fail(interaction, error);
    }
  },
};
