'use strict';

const { logger } = require('../utils/logger');
const { fail, rateLimited } = require('../utils/respond');
const { describeContext } = require('../utils/format');

/**
 * The single entry point for every interaction.
 *
 * Nothing in here is allowed to throw: an unhandled rejection from a command
 * must never take the gateway connection — or the process — down with it.
 */

/** Component and modal ids are `cmd:<command>:<action>` / `modal:<command>:<action>`. */
function parseCustomId(customId) {
  const [prefix, command, ...rest] = String(customId || '').split(':');
  return { prefix, command, action: rest.join(':') };
}

function createInteractionHandler({ commands, rateLimiters }) {
  const context = { commands, rateLimiters };

  /** Applies the command's rate-limit bucket. Returns true when allowed. */
  async function checkRateLimit(interaction, command) {
    if (typeof command.skipRateLimit === 'function' && command.skipRateLimit(interaction)) return true;

    const bucket =
      typeof command.rateLimitFor === 'function' ? command.rateLimitFor(interaction) : command.rateLimit || 'default';

    const verdict = rateLimiters.consume(bucket, interaction.user.id);
    if (verdict.allowed) return true;

    logger.debug('Rate limited', { command: interaction.commandName, bucket, userId: interaction.user.id });
    await rateLimited(interaction, verdict.retryAfterMs, command.rateLimitLabel || `\`/${interaction.commandName}\``);
    return false;
  }

  async function handleChatInput(interaction) {
    const command = commands.get(interaction.commandName);
    if (!command) {
      logger.warn('Received an unknown command', { command: interaction.commandName });
      return fail(interaction, Object.assign(new Error('That command is not available any more.'), { userFacing: true }));
    }

    const startedAt = Date.now();
    const meta = {
      command: interaction.commandName,
      subcommand: interaction.options.getSubcommand(false) || null,
      context: describeContext(interaction),
      guildId: interaction.guildId || null,
    };

    if (!(await checkRateLimit(interaction, command))) return undefined;

    try {
      await command.execute(interaction, context);
      logger.info('Command completed', { ...meta, ms: Date.now() - startedAt });
      return undefined;
    } catch (error) {
      logger.error('Command threw', { ...meta, ms: Date.now() - startedAt, error });
      return fail(interaction, error, { context: meta });
    }
  }

  async function handleAutocomplete(interaction) {
    const command = commands.get(interaction.commandName);
    if (!command || typeof command.autocomplete !== 'function') {
      return interaction.respond([]).catch(() => {});
    }
    try {
      await command.autocomplete(interaction, context);
    } catch (error) {
      // Autocomplete has a one-second budget and no way to show an error, so
      // the only sane failure mode is an empty list.
      logger.debug('Autocomplete failed', { command: interaction.commandName, error });
      await interaction.respond([]).catch(() => {});
    }
    return undefined;
  }

  async function handleComponent(interaction) {
    const { prefix, command: commandName, action } = parseCustomId(interaction.customId);
    if (prefix !== 'cmd') return undefined;

    const command = commands.get(commandName);
    if (!command || typeof command.handleComponent !== 'function') {
      return interaction.deferUpdate().catch(() => {});
    }

    try {
      await command.handleComponent(interaction, { ...context, action });
      return undefined;
    } catch (error) {
      logger.error('Component handler threw', { command: commandName, action, error });
      return fail(interaction, error, { context: { command: commandName, action } });
    }
  }

  async function handleModal(interaction) {
    const { prefix, command: commandName, action } = parseCustomId(interaction.customId);
    if (prefix !== 'modal') return undefined;

    const command = commands.get(commandName);
    if (!command || typeof command.handleModal !== 'function') {
      return fail(interaction, Object.assign(new Error('That form is no longer accepted.'), { userFacing: true }));
    }

    try {
      await command.handleModal(interaction, { ...context, action });
      return undefined;
    } catch (error) {
      logger.error('Modal handler threw', { command: commandName, action, error });
      return fail(interaction, error, { context: { command: commandName, action } });
    }
  }

  /** @param {import('discord.js').Interaction} interaction */
  return async function onInteraction(interaction) {
    try {
      if (interaction.isChatInputCommand()) return await handleChatInput(interaction);
      if (interaction.isAutocomplete()) return await handleAutocomplete(interaction);
      if (interaction.isModalSubmit()) return await handleModal(interaction);
      if (interaction.isButton() || interaction.isAnySelectMenu()) return await handleComponent(interaction);
      return undefined;
    } catch (error) {
      // The last line of defence. Reaching here means even the error path
      // failed, so all we can safely do is write it down.
      logger.error('Interaction handling failed catastrophically', { error });
      return undefined;
    }
  };
}

module.exports = { createInteractionHandler, parseCustomId };
