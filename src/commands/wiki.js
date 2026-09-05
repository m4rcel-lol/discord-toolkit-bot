'use strict';

const { SlashCommandBuilder } = require('discord.js');

const wikipedia = require('../services/wikipedia');
const { config } = require('../config');
const { createResultEmbed, createWarningEmbed, EMOJI, COLORS, truncate, escapeMarkdown } = require('../utils/embeds');
const { respond, defer, fail } = require('../utils/respond');

/**
 * `/wiki` — search, article summaries and random articles.
 * Everything goes through the official Wikimedia REST APIs; nothing is scraped.
 */

const LANGUAGE_CHOICES = [
  { name: 'English (en)', value: 'en' },
  { name: 'Deutsch (de)', value: 'de' },
  { name: 'Español (es)', value: 'es' },
  { name: 'Français (fr)', value: 'fr' },
  { name: 'Italiano (it)', value: 'it' },
  { name: 'Nederlands (nl)', value: 'nl' },
  { name: 'Polski (pl)', value: 'pl' },
  { name: 'Português (pt)', value: 'pt' },
  { name: 'Русский (ru)', value: 'ru' },
  { name: 'Svenska (sv)', value: 'sv' },
  { name: 'Türkçe (tr)', value: 'tr' },
  { name: '日本語 (ja)', value: 'ja' },
  { name: '中文 (zh)', value: 'zh' },
  { name: '한국어 (ko)', value: 'ko' },
  { name: 'العربية (ar)', value: 'ar' },
];

function articleEmbed(summary) {
  const fields = [];

  if (summary.isDisambiguation) {
    fields.push({
      name: `${EMOJI.warning} Disambiguation page`,
      value: 'This title refers to several different things. Pick a more specific one from the list on Wikipedia.',
    });
  }
  if (summary.coordinates) {
    fields.push({
      name: 'Coordinates',
      value: `\`${summary.coordinates.lat.toFixed(4)}, ${summary.coordinates.lon.toFixed(4)}\``,
      inline: true,
    });
  }
  fields.push({ name: 'Language', value: `\`${summary.language}.wikipedia.org\``, inline: true });
  if (summary.lastModified) {
    fields.push({
      name: 'Last edited',
      value: `<t:${Math.floor(new Date(summary.lastModified).getTime() / 1000)}:R>`,
      inline: true,
    });
  }

  return createResultEmbed({
    emoji: EMOJI.wiki,
    title: truncate(summary.displayTitle || summary.title, 240),
    url: summary.url,
    color: summary.isDisambiguation ? COLORS.warning : COLORS.brand,
    description: [
      summary.description ? `*${escapeMarkdown(truncate(summary.description, 200))}*` : null,
      summary.extract ? truncate(summary.extract, 1200) : '_No summary is available for this article._',
    ]
      .filter(Boolean)
      .join('\n\n'),
    thumbnail: summary.thumbnail || undefined,
    fields,
    footer: 'Wikipedia · CC BY-SA',
  });
}

function searchEmbed(result) {
  if (!result.results.length) {
    return createWarningEmbed({
      title: 'No results',
      description: `Nothing on the **${result.language}** Wikipedia matches **${escapeMarkdown(truncate(result.query, 100))}**.`,
      footer: 'Try a different spelling or another language',
    });
  }

  return createResultEmbed({
    emoji: EMOJI.wiki,
    title: `Wikipedia search`,
    color: COLORS.brand,
    description: `${result.results.length} result${result.results.length === 1 ? '' : 's'} for **${escapeMarkdown(truncate(result.query, 100))}** on ${result.language}.wikipedia.org`,
    thumbnail: result.results.find((entry) => entry.thumbnail)?.thumbnail || undefined,
    fields: result.results.map((entry, index) => ({
      name: `${index + 1}. ${truncate(entry.title, 240)}`,
      value: truncate(
        [
          entry.description ? `*${escapeMarkdown(entry.description)}*` : null,
          entry.excerpt ? escapeMarkdown(truncate(entry.excerpt, 200)) : null,
          `[Read the article](${entry.url})`,
        ]
          .filter(Boolean)
          .join('\n'),
        1000,
      ),
    })),
    footer: 'Wikipedia · CC BY-SA',
  });
}

module.exports = {
  category: 'wikipedia',
  rateLimit: 'wiki',
  rateLimitLabel: 'Wikipedia',

  data: new SlashCommandBuilder()
    .setName('wiki')
    .setDescription('Search Wikipedia and read article summaries.')
    .setDMPermission(true)
    .addSubcommand((sub) =>
      sub
        .setName('search')
        .setDescription('Search Wikipedia.')
        .addStringOption((option) =>
          option.setName('query').setDescription('What to search for').setRequired(true).setMaxLength(300),
        )
        .addStringOption((option) =>
          option.setName('language').setDescription('Language edition (default: en)').addChoices(...LANGUAGE_CHOICES),
        )
        .addIntegerOption((option) =>
          option.setName('results').setDescription('How many results (1–10, default 5)').setMinValue(1).setMaxValue(10),
        )
        .addBooleanOption((option) => option.setName('private').setDescription('Only you can see the result')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('article')
        .setDescription('Fetch the summary of one article.')
        .addStringOption((option) =>
          option
            .setName('title')
            .setDescription('The article title')
            .setRequired(true)
            .setAutocomplete(true)
            .setMaxLength(300),
        )
        .addStringOption((option) =>
          option.setName('language').setDescription('Language edition (default: en)').addChoices(...LANGUAGE_CHOICES),
        )
        .addBooleanOption((option) => option.setName('private').setDescription('Only you can see the result')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('random')
        .setDescription('Open a random Wikipedia article.')
        .addStringOption((option) =>
          option.setName('language').setDescription('Language edition (default: en)').addChoices(...LANGUAGE_CHOICES),
        )
        .addBooleanOption((option) => option.setName('private').setDescription('Only you can see the result')),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const language = interaction.options.getString('language') || config.wikipedia.defaultLanguage;
    const isPrivate = interaction.options.getBoolean('private') ?? false;

    if (!(await defer(interaction, { ephemeral: isPrivate }))) return;

    try {
      if (sub === 'search') {
        const result = await wikipedia.search(interaction.options.getString('query'), {
          language,
          limit: interaction.options.getInteger('results') || 5,
        });
        return await respond(interaction, { embeds: [searchEmbed(result)] });
      }

      if (sub === 'article') {
        const summary = await wikipedia.article(interaction.options.getString('title'), { language });
        return await respond(interaction, { embeds: [articleEmbed(summary)] });
      }

      const summary = await wikipedia.random({ language });
      return await respond(interaction, { embeds: [articleEmbed(summary)] });
    } catch (error) {
      // A missing article is far more useful with suggestions attached.
      if (error.code === 'NOT_FOUND' && error.suggestions?.length) {
        return respond(interaction, {
          embeds: [
            createWarningEmbed({
              title: 'No such article',
              description: `${error.message}\n\nDid you mean one of these?`,
              fields: error.suggestions.slice(0, 5).map((entry, index) => ({
                name: `${index + 1}. ${truncate(entry.title, 240)}`,
                value: truncate(
                  `${entry.description ? `*${escapeMarkdown(entry.description)}*\n` : ''}[Read the article](${entry.url})`,
                  1000,
                ),
              })),
            }),
          ],
        });
      }
      return fail(interaction, error);
    }
  },

  /** Live title suggestions from the OpenSearch endpoint. */
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'title') return interaction.respond([]);

    const language = interaction.options.getString('language') || config.wikipedia.defaultLanguage;
    const titles = await wikipedia.suggestTitles(focused.value, { language, limit: 10 });
    return interaction.respond(
      titles.slice(0, 25).map((title) => ({ name: truncate(title, 100), value: truncate(title, 100) })),
    );
  },
};
