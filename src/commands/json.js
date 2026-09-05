'use strict';

const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');

const jsonService = require('../services/json');
const { createResultEmbed, createSuccessEmbed, codeBlock, EMOJI, COLORS, truncate } = require('../utils/embeds');
const { respond, defer, fail } = require('../utils/respond');
const { humanBytes } = require('../utils/format');
const { ValidationError, stripCodeFence, assertPublicUrl } = require('../utils/validation');
const { logger } = require('../utils/logger');

/** `/json` — format, minify, validate and diff JSON, from text or a file. */

const FIELD_LIMIT = 1000;
const MAX_FILE_BYTES = 1024 * 1024;

/**
 * JSON can arrive as a command option or as an uploaded `.json` file.
 * @returns {Promise<{ text: string, source: string }>}
 */
async function resolveInput(interaction, { textOption = 'json', fileOption = 'file' } = {}) {
  const attachment = interaction.options.getAttachment(fileOption);
  const text = interaction.options.getString(textOption);

  if (attachment) {
    if (attachment.size > MAX_FILE_BYTES) {
      throw new ValidationError(`That file is ${humanBytes(attachment.size)} — the limit is ${humanBytes(MAX_FILE_BYTES)}.`);
    }
    assertPublicUrl(attachment.url, 'attachment');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(attachment.url, { signal: controller.signal });
      if (!response.ok) throw new ValidationError('The doggy could not download that file from Discord.');
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_FILE_BYTES) throw new ValidationError('That file is too large.');
      return { text: buffer.toString('utf8'), source: attachment.name || 'uploaded file' };
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      if (error.name === 'AbortError') throw new ValidationError('Downloading that file took too long.');
      logger.warn('JSON attachment download failed', { error });
      throw new ValidationError('The doggy could not download that file.');
    } finally {
      clearTimeout(timer);
    }
  }

  if (text) return { text: stripCodeFence(text), source: 'the `json` option' };

  throw new ValidationError('Provide JSON either in the `json` option or as an uploaded `file`.');
}

/** Output that fits goes in a code block; anything bigger becomes a file. */
function outputPayload(text, filename, language = 'json') {
  if (text.length <= FIELD_LIMIT) {
    return { field: codeBlock(text, language, FIELD_LIMIT + 20), files: [] };
  }
  return {
    field: `${codeBlock(`${text.slice(0, FIELD_LIMIT - 40)}…`, language, FIELD_LIMIT + 20)}\n📎 Full output attached.`,
    files: [new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: filename })],
  };
}

function structureField(info) {
  return {
    name: 'Structure',
    value:
      `Root: \`${info.rootType}\`` +
      (info.keys !== null ? ` · ${info.keys} key${info.keys === 1 ? '' : 's'}` : '') +
      (info.length !== null ? ` · ${info.length} item${info.length === 1 ? '' : 's'}` : '') +
      `\nDepth: \`${info.depth}\` · Nodes: \`${info.nodes}\``,
    inline: false,
  };
}

module.exports = {
  category: 'developer',
  rateLimit: 'default',

  data: new SlashCommandBuilder()
    .setName('json')
    .setDescription('Format, minify, validate and diff JSON.')
    .setDMPermission(true)
    .addSubcommand((sub) =>
      sub
        .setName('format')
        .setDescription('Pretty-print JSON.')
        .addStringOption((option) => option.setName('json').setDescription('The JSON (a code block works too)').setMaxLength(4000))
        .addAttachmentOption((option) => option.setName('file').setDescription('A .json file to format instead'))
        .addIntegerOption((option) =>
          option.setName('indent').setDescription('Spaces per level (0–8, default 2)').setMinValue(0).setMaxValue(8),
        )
        .addBooleanOption((option) => option.setName('sort_keys').setDescription('Sort object keys alphabetically'))
        .addBooleanOption((option) => option.setName('private').setDescription('Only you can see the result')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('minify')
        .setDescription('Strip all unnecessary whitespace.')
        .addStringOption((option) => option.setName('json').setDescription('The JSON (a code block works too)').setMaxLength(4000))
        .addAttachmentOption((option) => option.setName('file').setDescription('A .json file to minify instead'))
        .addBooleanOption((option) => option.setName('private').setDescription('Only you can see the result')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('validate')
        .setDescription('Check whether JSON is valid and pinpoint the first error.')
        .addStringOption((option) => option.setName('json').setDescription('The JSON (a code block works too)').setMaxLength(4000))
        .addAttachmentOption((option) => option.setName('file').setDescription('A .json file to validate instead'))
        .addBooleanOption((option) => option.setName('private').setDescription('Only you can see the result')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('diff')
        .setDescription('Compare two JSON documents structurally.')
        .addStringOption((option) => option.setName('first').setDescription('The first JSON document').setMaxLength(4000))
        .addStringOption((option) => option.setName('second').setDescription('The second JSON document').setMaxLength(4000))
        .addAttachmentOption((option) => option.setName('first_file').setDescription('The first document as a file'))
        .addAttachmentOption((option) => option.setName('second_file').setDescription('The second document as a file'))
        .addBooleanOption((option) => option.setName('private').setDescription('Only you can see the result')),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const isPrivate = interaction.options.getBoolean('private') ?? false;

    if (!(await defer(interaction, { ephemeral: isPrivate }))) return;

    try {
      if (sub === 'diff') return await runDiff(interaction);

      const { text, source } = await resolveInput(interaction);

      if (sub === 'format') {
        const result = jsonService.format(text, {
          indent: interaction.options.getInteger('indent') ?? 2,
          sortKeys: interaction.options.getBoolean('sort_keys') ?? false,
        });
        const payload = outputPayload(result.output, 'formatted.json');
        return await respond(interaction, {
          files: payload.files,
          embeds: [
            createResultEmbed({
              emoji: EMOJI.developer,
              title: 'JSON formatted',
              color: COLORS.success,
              description: `Read from ${source}.`,
              fields: [
                { name: 'Output', value: payload.field },
                structureField(result.info),
                { name: 'Size', value: `${humanBytes(result.originalLength)} → ${humanBytes(result.output.length)}`, inline: true },
              ],
            }),
          ],
        });
      }

      if (sub === 'minify') {
        const result = jsonService.minify(text);
        const payload = outputPayload(result.output, 'minified.json');
        return await respond(interaction, {
          files: payload.files,
          embeds: [
            createResultEmbed({
              emoji: EMOJI.developer,
              title: 'JSON minified',
              color: COLORS.success,
              description: `Read from ${source}.`,
              fields: [
                { name: 'Output', value: payload.field },
                {
                  name: 'Saved',
                  value: `${humanBytes(result.savedBytes)} (${result.savedPercent}%)`,
                  inline: true,
                },
                { name: 'Size', value: `${humanBytes(result.originalLength)} → ${humanBytes(result.output.length)}`, inline: true },
              ],
            }),
          ],
        });
      }

      const result = jsonService.validate(text);
      return await respond(interaction, {
        embeds: [
          result.valid
            ? createSuccessEmbed({
                title: 'JSON is valid',
                description: `${source} parsed cleanly.`,
                fields: [structureField(result.info)],
              })
            : createResultEmbed({
                emoji: EMOJI.developer,
                title: 'JSON is not valid',
                color: COLORS.error,
                description: `${EMOJI.red} ${result.message}`,
                fields: result.hint ? [{ name: `${EMOJI.info} Hint`, value: result.hint }] : [],
              }),
        ],
      });
    } catch (error) {
      return fail(interaction, error);
    }
  },
};

const OP_ICON = { added: '🟢', removed: '🔴', changed: '🟡' };

async function runDiff(interaction) {
  const first = await resolveInput(interaction, { textOption: 'first', fileOption: 'first_file' });
  const second = await resolveInput(interaction, { textOption: 'second', fileOption: 'second_file' });

  const result = jsonService.diff(first.text, second.text);

  if (result.identical) {
    return respond(interaction, {
      embeds: [
        createResultEmbed({
          emoji: EMOJI.developer,
          title: 'JSON diff',
          color: COLORS.success,
          description: `${EMOJI.success} The two documents are structurally identical.`,
        }),
      ],
    });
  }

  const lines = result.changes.slice(0, 25).map((change) => {
    const path = change.path || '(root)';
    if (change.op === 'added') return `${OP_ICON.added} \`${path}\` → ${jsonService.preview(change.to)}`;
    if (change.op === 'removed') return `${OP_ICON.removed} \`${path}\` was ${jsonService.preview(change.from)}`;
    return `${OP_ICON.changed} \`${path}\` ${jsonService.preview(change.from)} → ${jsonService.preview(change.to)}`;
  });

  const files = [];
  if (result.changes.length > 25 || result.truncated) {
    const full = result.changes
      .map((change) => `${change.op.toUpperCase()} ${change.path || '(root)'}  ${jsonService.preview(change.from, 200)} -> ${jsonService.preview(change.to, 200)}`)
      .join('\n');
    files.push(new AttachmentBuilder(Buffer.from(full, 'utf8'), { name: 'diff.txt' }));
  }

  return respond(interaction, {
    files,
    embeds: [
      createResultEmbed({
        emoji: EMOJI.developer,
        title: 'JSON diff',
        color: COLORS.warning,
        description: truncate(lines.join('\n'), 3800),
        fields: [
          { name: '🟢 Added', value: String(result.summary.added), inline: true },
          { name: '🔴 Removed', value: String(result.summary.removed), inline: true },
          { name: '🟡 Changed', value: String(result.summary.changed), inline: true },
          ...(result.truncated
            ? [{ name: `${EMOJI.warning} Truncated`, value: 'Only the first 200 differences were compared.' }]
            : []),
        ],
        footer: files.length ? 'Full diff attached' : undefined,
      }),
    ],
  });
}
