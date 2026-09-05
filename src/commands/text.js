'use strict';

const { SlashCommandBuilder } = require('discord.js');

const text = require('../services/text');
const { createResultEmbed, codeBlock, EMOJI, COLORS } = require('../utils/embeds');
const { respond, fail } = require('../utils/respond');
const { humanBytes } = require('../utils/format');

/** `/text` — the small string tools people keep reaching for. */

const TRANSFORM_CHOICES = text.listTransforms().map((entry) => ({ name: entry.label, value: entry.key }));

module.exports = {
  category: 'utilities',
  rateLimit: 'default',

  data: new SlashCommandBuilder()
    .setName('text')
    .setDescription('Change case, build slugs and count what you have written.')
    .setDMPermission(true)
    .addSubcommand((sub) =>
      sub
        .setName('transform')
        .setDescription('Convert text between cases and formats.')
        .addStringOption((option) =>
          option.setName('text').setDescription('The text to transform').setRequired(true).setMaxLength(4000),
        )
        .addStringOption((option) =>
          option.setName('mode').setDescription('How to transform it').setRequired(true).addChoices(...TRANSFORM_CHOICES),
        )
        .addBooleanOption((option) => option.setName('private').setDescription('Only you can see the result')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('count')
        .setDescription('Count characters, words, lines and bytes.')
        .addStringOption((option) =>
          option.setName('text').setDescription('The text to measure').setRequired(true).setMaxLength(4000),
        )
        .addBooleanOption((option) => option.setName('private').setDescription('Only you can see the result')),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const isPrivate = interaction.options.getBoolean('private') ?? false;
    const input = interaction.options.getString('text');

    try {
      if (sub === 'transform') {
        const result = text.transform(input, interaction.options.getString('mode'));
        return await respond(interaction, {
          ephemeral: isPrivate,
          embeds: [
            createResultEmbed({
              emoji: EMOJI.utilities,
              title: result.label,
              color: COLORS.success,
              fields: [{ name: 'Result', value: codeBlock(result.output, '', 1000) }],
            }),
          ],
        });
      }

      const stats = text.count(input);
      return await respond(interaction, {
        ephemeral: isPrivate,
        embeds: [
          createResultEmbed({
            emoji: EMOJI.utilities,
            title: 'Text statistics',
            color: COLORS.brand,
            fields: [
              { name: 'Characters', value: `\`${stats.characters}\``, inline: true },
              { name: 'Without spaces', value: `\`${stats.charactersNoSpaces}\``, inline: true },
              { name: 'Bytes (UTF-8)', value: `\`${humanBytes(stats.bytes)}\``, inline: true },
              { name: 'Words', value: `\`${stats.words}\``, inline: true },
              { name: 'Unique words', value: `\`${stats.uniqueWords}\``, inline: true },
              { name: 'Sentences', value: `\`${stats.sentences}\``, inline: true },
              { name: 'Lines', value: `\`${stats.lines}\``, inline: true },
              { name: 'Average word', value: `\`${stats.averageWordLength}\` chars`, inline: true },
              { name: 'Longest word', value: `\`${stats.longestWord || '—'}\``, inline: true },
            ],
          }),
        ],
      });
    } catch (error) {
      return fail(interaction, error);
    }
  },
};
