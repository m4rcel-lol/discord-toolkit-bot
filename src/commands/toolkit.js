'use strict';

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const { config } = require('../config');
const { CATEGORIES, findCategory } = require('../utils/catalog');
const { createResultEmbed, createInfoEmbed, createLoadingEmbed, EMOJI, COLORS } = require('../utils/embeds');
const { respond } = require('../utils/respond');
const { summaryLine } = require('../sandbox/limits');
const { humanDuration } = require('../utils/format');

/** `/toolkit` — the bot's homepage, and the entry point for every category. */

const INVITE_PERMISSIONS = '0'; // No privileged permissions are needed at all.

function homeEmbed() {
  return createResultEmbed({
    emoji: EMOJI.toolkit,
    title: config.branding.name,
    color: COLORS.brand,
    description:
      'Your friendly Discord utility toolkit — pick a category below, or jump straight to a command.\n' +
      'Everything works in servers, DMs and group DMs.',
    fields: CATEGORIES.map((category) => ({
      name: `${category.emoji} ${category.name}`,
      value: category.blurb,
      inline: false,
    })),
    footer: `v${config.branding.version}`,
  });
}

function categoryEmbed(category) {
  return createResultEmbed({
    emoji: category.emoji,
    title: category.name,
    color: COLORS.brand,
    description: category.blurb,
    fields: category.commands.map((command) => ({
      name: command.name,
      value: command.description,
      inline: false,
    })),
    footer: 'Use the menu to browse another category',
  });
}

function components(selectedId) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('cmd:toolkit:category')
    .setPlaceholder('Browse a category…')
    .addOptions(
      CATEGORIES.map((category) => ({
        label: category.name,
        value: category.id,
        description: category.blurb.slice(0, 100),
        emoji: category.emoji,
        default: category.id === selectedId,
      })),
    );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cmd:toolkit:home').setLabel('Home').setEmoji(EMOJI.dog).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cmd:toolkit:about').setLabel('About & status').setStyle(ButtonStyle.Secondary),
  );

  return [new ActionRowBuilder().addComponents(menu), buttons];
}

async function aboutEmbed(client) {
  const luau = require('../services/luau');
  const wikipedia = require('../services/wikipedia');
  const worker = await luau.health({ timeoutMs: 2000 });

  const queue = luau.stats().queue;
  const ping = Math.max(0, Math.round(client?.ws?.ping ?? 0));

  return createInfoEmbed({
    title: `${EMOJI.info} About ${config.branding.name}`,
    description:
      'A cute but genuinely powerful toolbox that lives inside Discord.\n' +
      'No elevated permissions, no data kept, no code running anywhere it should not.',
    fields: [
      { name: 'Version', value: `\`${config.branding.version}\``, inline: true },
      { name: 'Uptime', value: humanDuration(process.uptime() * 1000), inline: true },
      { name: 'Gateway', value: `${ping} ms`, inline: true },
      {
        name: 'Luau sandbox',
        value: worker.ok ? `${EMOJI.green} Online · ${summaryLine()}` : `${EMOJI.red} Unavailable`,
        inline: false,
      },
      {
        name: 'Sandbox queue',
        value: `${queue.active} running · ${queue.waiting} waiting`,
        inline: true,
      },
      { name: 'Wikipedia cache', value: `${wikipedia.stats().cacheSize} entries`, inline: true },
      { name: 'Servers', value: `${client?.guilds?.cache?.size ?? 0}`, inline: true },
      {
        name: 'Privacy',
        value:
          'Submitted code, uploaded images and command input are processed in memory and thrown away. ' +
          'Nothing is written to a database.',
        inline: false,
      },
    ],
    footer: 'Minimum permissions · works in DMs',
  });
}

module.exports = {
  category: 'utilities',
  rateLimit: 'default',

  data: new SlashCommandBuilder()
    .setName('toolkit')
    .setDescription("Open m5rcel's tool doggy — every tool in one place.")
    .setDMPermission(true)
    .addStringOption((option) =>
      option
        .setName('category')
        .setDescription('Jump straight to one category')
        .setRequired(false)
        .addChoices(...CATEGORIES.map((category) => ({ name: `${category.emoji} ${category.name}`, value: category.id }))),
    )
    .addBooleanOption((option) =>
      option.setName('private').setDescription('Only you can see the reply (default: true)').setRequired(false),
    ),

  async execute(interaction) {
    const isPrivate = interaction.options.getBoolean('private') ?? true;
    const categoryId = interaction.options.getString('category');
    const category = categoryId ? findCategory(categoryId) : null;

    await respond(interaction, {
      embeds: [category ? categoryEmbed(category) : homeEmbed()],
      components: components(category?.id),
      ephemeral: isPrivate,
    });
  },

  /** Handles the category select menu and the two buttons. */
  async handleComponent(interaction, { action }) {
    if (action === 'category') {
      const category = findCategory(interaction.values?.[0]);
      if (!category) return interaction.deferUpdate();
      return interaction.update({ embeds: [categoryEmbed(category)], components: components(category.id) });
    }

    if (action === 'home') {
      return interaction.update({ embeds: [homeEmbed()], components: components() });
    }

    if (action === 'about') {
      // Pinging the sandbox takes a moment, so say so rather than leaving the
      // previous page on screen while nothing appears to happen.
      await interaction.update({
        embeds: [createLoadingEmbed({ title: 'Checking on things', description: 'Asking the sandbox how it is doing…' })],
        components: components(),
      });
      return interaction.editReply({ embeds: [await aboutEmbed(interaction.client)], components: components() });
    }

    return interaction.deferUpdate();
  },

  // Exported for documentation and tests: the bot asks for no permissions.
  INVITE_PERMISSIONS,
  homeEmbed,
  categoryEmbed,
};
