'use strict';

const { SlashCommandBuilder } = require('discord.js');

const { calculate, formatNumber, suggestions } = require('../services/calculator');
const { createResultEmbed, codeBlock, EMOJI, COLORS, truncate } = require('../utils/embeds');
const { respond, fail } = require('../utils/respond');
const { groupDigits } = require('../utils/format');

/**
 * `/calc` — a safe expression evaluator.
 *
 * The expression is tokenised, parsed into an AST and walked by an
 * interpreter. There is no `eval`, no `new Function` and no `vm` anywhere in
 * `src/services/calculator/`.
 */

const ALL_SUGGESTIONS = suggestions();

function resultFields(result) {
  const fields = [];

  if (result.kind === 'conversion') {
    const { from, to } = result.detail;
    fields.push({ name: 'From', value: `\`${from.formatted} ${from.key}\`\n${from.label}`, inline: true });
    fields.push({ name: 'To', value: `\`${result.formatted} ${to.key}\`\n${to.label}`, inline: true });
    fields.push({ name: 'Dimension', value: result.detail.dimension, inline: true });
    return fields;
  }

  if (result.kind === 'base') {
    const { radixLabel, decimal, views } = result.detail;
    fields.push({ name: 'Decimal', value: `\`${decimal}\``, inline: true });
    fields.push({ name: radixLabel.replace(/^\w/, (c) => c.toUpperCase()), value: `\`${result.formatted}\``, inline: true });
    if (views) {
      fields.push({ name: 'Also', value: `bin \`${views.binary}\`\noct \`${views.octal}\`\nhex \`${views.hexadecimal}\`` });
    }
    return fields;
  }

  const views = result.detail?.views;
  if (views) {
    fields.push({ name: 'Binary', value: `\`${truncate(views.binary, 60)}\``, inline: true });
    fields.push({ name: 'Octal', value: `\`${truncate(views.octal, 40)}\``, inline: true });
    fields.push({ name: 'Hex', value: `\`${views.hexadecimal}\``, inline: true });
  }
  return fields;
}

module.exports = {
  category: 'calculator',
  rateLimit: 'default',

  data: new SlashCommandBuilder()
    .setName('calc')
    .setDescription('Evaluate an expression, convert units, or change number base.')
    .setDMPermission(true)
    .addStringOption((option) =>
      option
        .setName('expression')
        .setDescription('e.g. 5 * (20 + 3) · sqrt(144) · 2^32 · 255 to binary · 1 GiB to bytes')
        .setRequired(true)
        .setAutocomplete(true)
        .setMaxLength(500),
    )
    .addBooleanOption((option) =>
      option.setName('private').setDescription('Only you can see the result').setRequired(false),
    ),

  async execute(interaction) {
    const expression = interaction.options.getString('expression');
    const isPrivate = interaction.options.getBoolean('private') ?? false;

    try {
      const result = calculate(expression);
      const headline = result.kind === 'conversion'
        ? `${result.formatted} ${result.detail.to.key}`
        : result.formatted;

      return await respond(interaction, {
        ephemeral: isPrivate,
        embeds: [
          createResultEmbed({
            emoji: EMOJI.calculator,
            title: 'Calculator',
            color: COLORS.brand,
            description: `${codeBlock(truncate(result.input, 200), '', 250)}\n**=** \`${truncate(headline, 200)}\``,
            fields: resultFields(result),
            footer:
              result.kind === 'conversion' ? 'Unit conversion' :
              result.kind === 'base' ? 'Base conversion' : 'Expression',
          }),
        ],
      });
    } catch (error) {
      return fail(interaction, error, { ephemeral: true });
    }
  },

  /**
   * Completes the identifier the user is currently typing, so `sq` offers
   * `sqrt(` and `GiB`/`bytes` show up when converting.
   */
  async autocomplete(interaction) {
    const typed = interaction.options.getFocused() || '';
    const match = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(typed);
    const prefix = match ? match[1].toLowerCase() : '';
    const head = match ? typed.slice(0, typed.length - match[1].length) : typed;

    let choices;
    if (!prefix) {
      choices = [
        '5 * (20 + 3)',
        'sqrt(144)',
        '2^32',
        '255 to binary',
        '1 GiB to bytes',
        '20 C to F',
        'log2(1024)',
        '50% of 200',
      ]
        .filter((example) => !typed || example.startsWith(typed))
        .map((example) => ({ name: example, value: example }));
    } else {
      choices = ALL_SUGGESTIONS
        .filter((name) => name.toLowerCase().startsWith(prefix))
        .slice(0, 25)
        .map((name) => {
          const value = `${head}${name}`;
          return { name: truncate(value, 100), value: truncate(value, 100) };
        });
    }

    // A live preview of the current expression is the most useful entry there is.
    try {
      const preview = calculate(typed);
      const label = `= ${groupDigits(formatNumber(preview.value, { group: false }))}`;
      choices.unshift({ name: truncate(`${typed}  ${label}`, 100), value: truncate(typed, 100) });
    } catch {
      // Incomplete expressions are the normal case while typing.
    }

    return interaction.respond(choices.slice(0, 25));
  },
};
