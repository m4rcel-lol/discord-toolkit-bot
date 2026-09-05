'use strict';

const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');

const qr = require('../services/qr');
const { createResultEmbed, codeBlock, EMOJI, COLORS, truncate } = require('../utils/embeds');
const { respond, defer, fail } = require('../utils/respond');
const { humanBytes } = require('../utils/format');
const { ValidationError, assertPublicUrl } = require('../utils/validation');
const { logger } = require('../utils/logger');

/**
 * `/qr` — generation and decoding.
 *
 * Decoded payloads are only ever displayed as text: the bot never opens,
 * resolves or previews a URL that came out of a QR code, and the uploaded
 * image is discarded as soon as the scan finishes.
 */

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 10000;

const TYPE_CHOICES = [
  { name: 'URL', value: 'url' },
  { name: 'Plain text', value: 'text' },
  { name: 'Email', value: 'email' },
  { name: 'Telephone', value: 'phone' },
  { name: 'SMS', value: 'sms' },
  { name: 'Wi-Fi network', value: 'wifi' },
  { name: 'Discord invite', value: 'discord' },
  { name: 'Contact card (vCard)', value: 'vcard' },
];

async function downloadAttachment(attachment) {
  if (attachment.size > MAX_ATTACHMENT_BYTES) {
    throw new ValidationError(`That image is ${humanBytes(attachment.size)} — the limit is ${humanBytes(MAX_ATTACHMENT_BYTES)}.`);
  }
  if (attachment.contentType && !/^image\//i.test(attachment.contentType)) {
    throw new ValidationError('That attachment is not an image.', { hint: 'Upload a PNG, JPEG, GIF, BMP or TIFF.' });
  }

  // Discord CDN only, and never a private address.
  assertPublicUrl(attachment.url, 'attachment');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(attachment.url, { signal: controller.signal });
    if (!response.ok) throw new ValidationError('The doggy could not download that attachment from Discord.');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_ATTACHMENT_BYTES) throw new ValidationError('That image is too large to scan.');
    return buffer;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error.name === 'AbortError') throw new ValidationError('Downloading that image took too long.');
    logger.warn('QR attachment download failed', { error });
    throw new ValidationError('The doggy could not download that attachment.');
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  category: 'qr',
  rateLimit: 'default',

  data: new SlashCommandBuilder()
    .setName('qr')
    .setDescription('Create QR codes, or read one out of an image.')
    .setDMPermission(true)
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Generate a QR code.')
        .addStringOption((option) =>
          option.setName('value').setDescription('The URL, text, address, number or network name').setRequired(true).setMaxLength(2000),
        )
        .addStringOption((option) =>
          option.setName('type').setDescription('What kind of QR code (default: URL if it looks like one)').addChoices(...TYPE_CHOICES),
        )
        .addStringOption((option) =>
          option.setName('extra').setDescription('Wi-Fi password · email subject · SMS message · vCard phone').setMaxLength(200),
        )
        .addStringOption((option) =>
          option
            .setName('error_correction')
            .setDescription('Higher levels survive more damage but hold less data (default: M)')
            .addChoices(
              { name: 'L — 7% recovery', value: 'L' },
              { name: 'M — 15% recovery (default)', value: 'M' },
              { name: 'Q — 25% recovery', value: 'Q' },
              { name: 'H — 30% recovery', value: 'H' },
            ),
        )
        .addBooleanOption((option) => option.setName('private').setDescription('Only you can see the result')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('decode')
        .setDescription('Read the contents of a QR code image.')
        .addAttachmentOption((option) =>
          option.setName('image').setDescription('An image containing a QR code').setRequired(true),
        )
        .addBooleanOption((option) => option.setName('private').setDescription('Only you can see the result')),
    ),

  rateLimitFor(interaction) {
    return interaction.options.getSubcommand() === 'decode' ? 'qrDecode' : 'default';
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const isPrivate = interaction.options.getBoolean('private') ?? false;

    if (!(await defer(interaction, { ephemeral: isPrivate }))) return;

    try {
      if (sub === 'create') return await create(interaction);
      return await decode(interaction);
    } catch (error) {
      return fail(interaction, error);
    }
  },
};

async function create(interaction) {
  const value = interaction.options.getString('value');
  const extra = interaction.options.getString('extra');
  const errorCorrection = interaction.options.getString('error_correction') || 'M';

  // Guess the type when the user did not pick one — a URL is by far the
  // most common thing people put in a QR code.
  const explicitType = interaction.options.getString('type');
  const type = explicitType || (/^(https?:\/\/|www\.)|^[\w-]+\.[a-z]{2,}(\/|$)/i.test(value.trim()) ? 'url' : 'text');

  // One `extra` option keeps the command approachable; each payload builder
  // reads only the field that means something for its own type, so a Wi-Fi
  // password never leaks into an email subject.
  const result = await qr.createQr({
    type,
    value,
    errorCorrection,
    password: extra,
    subject: extra,
    body: extra,
    phone: extra,
    security: extra ? 'WPA' : 'nopass',
  });

  const file = new AttachmentBuilder(result.buffer, { name: 'qr.png' });

  return respond(interaction, {
    files: [file],
    embeds: [
      createResultEmbed({
        emoji: EMOJI.qr,
        title: 'QR code',
        color: COLORS.brand,
        description: result.summary,
        image: 'attachment://qr.png',
        fields: [
          { name: 'Type', value: result.meta.typeLabel, inline: true },
          { name: 'Error correction', value: `Level ${result.meta.errorCorrectionLevel}`, inline: true },
          { name: 'Payload', value: `${result.meta.payloadLength} characters`, inline: true },
          { name: 'Encoded content', value: codeBlock(truncate(result.payload, 800), '', 900) },
        ],
        footer: 'Scan it with any camera app',
      }),
    ],
  });
}

async function decode(interaction) {
  const attachment = interaction.options.getAttachment('image');
  const buffer = await downloadAttachment(attachment);

  let decoded;
  try {
    decoded = await qr.decodeQr(buffer);
  } finally {
    // Nothing is written to disk, and the bytes go out of scope right here.
  }

  const isUrl = decoded.kind === 'URL';

  return respond(interaction, {
    embeds: [
      createResultEmbed({
        emoji: EMOJI.qr,
        title: 'QR decoded',
        color: COLORS.success,
        description: `${EMOJI.success} Found a **${decoded.kind}** payload.`,
        fields: [
          { name: 'Contents', value: codeBlock(truncate(decoded.data, 900), '', 1000) },
          { name: 'Image', value: `${decoded.dimensions.width}×${decoded.dimensions.height} · ${humanBytes(attachment.size)}`, inline: true },
          { name: 'Kind', value: decoded.kind, inline: true },
          ...(isUrl
            ? [{
                name: `${EMOJI.warning} Careful`,
                value: 'The doggy did **not** open this link. Check it before you visit it.',
              }]
            : []),
        ],
        footer: 'The uploaded image was not stored',
      }),
    ],
  });
}
