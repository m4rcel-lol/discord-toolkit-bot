'use strict';

const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');

const colors = require('../services/colors');
const { createResultEmbed, EMOJI, COLORS, truncate } = require('../utils/embeds');
const { respond, defer, fail } = require('../utils/respond');

/** `/color` — conversion, WCAG contrast checking and harmony palettes. */

const SCHEME_CHOICES = colors.listSchemes().map((scheme) => ({ name: scheme.label, value: scheme.key }));

function convertEmbed(description, imageName) {
  const { hex, rgb, hsl, hsv, cmyk, name, int, css } = description;
  return createResultEmbed({
    emoji: EMOJI.colors,
    title: 'Color',
    color: int,
    description: name ? `Closest CSS name: **${name}**` : undefined,
    thumbnail: imageName ? `attachment://${imageName}` : undefined,
    fields: [
      { name: 'HEX', value: `\`${hex}\``, inline: true },
      { name: 'RGB', value: `\`${rgb.r}, ${rgb.g}, ${rgb.b}\``, inline: true },
      { name: 'HSL', value: `\`${hsl.h}°, ${hsl.s}%, ${hsl.l}%\``, inline: true },
      { name: 'HSV', value: `\`${hsv.h}°, ${hsv.s}%, ${hsv.v}%\``, inline: true },
      { name: 'CMYK', value: `\`${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%\``, inline: true },
      { name: 'Integer', value: `\`${int}\``, inline: true },
      { name: 'CSS', value: `\`\`\`css\ncolor: ${css.hex};\ncolor: ${css.rgb};\ncolor: ${css.hsl};\n\`\`\`` },
    ],
  });
}

function contrastEmbed(check, imageName) {
  const verdict = check.results
    .map((result) => `${result.passes ? EMOJI.success : EMOJI.error} **${result.label}** — needs ${result.minimum}:1`)
    .join('\n');

  const colour = check.ratio >= 4.5 ? COLORS.success : check.ratio >= 3 ? COLORS.warning : COLORS.error;

  return createResultEmbed({
    emoji: EMOJI.colors,
    title: 'Contrast',
    color: colour,
    description: `### ${check.ratioText}\n**${check.grade}** — ${check.passingCount} of ${check.results.length} WCAG checks pass.`,
    image: imageName ? `attachment://${imageName}` : undefined,
    fields: [
      { name: 'Foreground', value: `\`${check.foreground.hex}\`\nluminance ${check.foreground.luminance}`, inline: true },
      { name: 'Background', value: `\`${check.background.hex}\`\nluminance ${check.background.luminance}`, inline: true },
      { name: 'WCAG 2.1', value: verdict },
    ],
    footer: 'Large text is 18.66px bold or 24px regular',
  });
}

function paletteEmbed(palette, imageName) {
  const base = colors.parseColor(palette.base);
  return createResultEmbed({
    emoji: EMOJI.colors,
    title: `${palette.label} palette`,
    color: (base.r << 16) + (base.g << 8) + base.b,
    description: `${palette.description}\nBased on \`${palette.base}\`.`,
    image: imageName ? `attachment://${imageName}` : undefined,
    fields: [
      {
        name: 'Colors',
        value: palette.colors.map((color) => `\`${color.hex}\` · rgb(${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b})`).join('\n'),
      },
      {
        name: 'Copy',
        value: `\`\`\`\n${palette.colors.map((color) => color.hex).join(', ')}\n\`\`\``,
      },
    ],
  });
}

module.exports = {
  category: 'colors',
  rateLimit: 'default',

  data: new SlashCommandBuilder()
    .setName('color')
    .setDescription('Convert colors, check WCAG contrast and build palettes.')
    .setDMPermission(true)
    .addSubcommand((sub) =>
      sub
        .setName('convert')
        .setDescription('Show a color in HEX, RGB, HSL, HSV and CMYK.')
        .addStringOption((option) =>
          option
            .setName('color')
            .setDescription('#FF6600 · rgb(255,102,0) · hsl(24,100%,50%) · cmyk(0,60,100,0) · tomato')
            .setRequired(true)
            .setMaxLength(100),
        )
        .addBooleanOption((option) => option.setName('private').setDescription('Only you can see the result')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('contrast')
        .setDescription('Check the WCAG contrast ratio between two colors.')
        .addStringOption((option) =>
          option.setName('foreground').setDescription('Text color, e.g. #FFFFFF').setRequired(true).setMaxLength(100),
        )
        .addStringOption((option) =>
          option.setName('background').setDescription('Background color, e.g. #FF6600').setRequired(true).setMaxLength(100),
        )
        .addBooleanOption((option) => option.setName('private').setDescription('Only you can see the result')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('palette')
        .setDescription('Generate a color harmony palette.')
        .addStringOption((option) =>
          option.setName('color').setDescription('The base color, e.g. #FF6600').setRequired(true).setMaxLength(100),
        )
        .addStringOption((option) =>
          option.setName('scheme').setDescription('Harmony rule (default: complementary)').addChoices(...SCHEME_CHOICES),
        )
        .addBooleanOption((option) => option.setName('private').setDescription('Only you can see the result')),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const isPrivate = interaction.options.getBoolean('private') ?? false;

    // Rendering a PNG takes longer than Discord's three-second window allows.
    if (!(await defer(interaction, { ephemeral: isPrivate }))) return;

    try {
      if (sub === 'convert') {
        const description = colors.describeColor(interaction.options.getString('color'));
        const buffer = await colors.renderSwatch({ hex: description.hex }, { size: 256 });
        const file = new AttachmentBuilder(buffer, { name: 'swatch.png' });
        return await respond(interaction, { embeds: [convertEmbed(description, 'swatch.png')], files: [file] });
      }

      if (sub === 'contrast') {
        const check = colors.checkContrast(
          interaction.options.getString('foreground'),
          interaction.options.getString('background'),
        );
        const buffer = await colors.renderContrastPreview(check.foreground, check.background);
        const file = new AttachmentBuilder(buffer, { name: 'contrast.png' });
        return await respond(interaction, { embeds: [contrastEmbed(check, 'contrast.png')], files: [file] });
      }

      const palette = colors.buildPalette(
        interaction.options.getString('color'),
        interaction.options.getString('scheme') || 'complementary',
      );
      const buffer = await colors.renderPalette(palette.colors, {
        title: truncate(`${palette.label} · ${palette.base}`, 60),
      });
      const file = new AttachmentBuilder(buffer, { name: 'palette.png' });
      return await respond(interaction, { embeds: [paletteEmbed(palette, 'palette.png')], files: [file] });
    } catch (error) {
      return fail(interaction, error);
    }
  },
};
