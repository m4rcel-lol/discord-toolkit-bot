'use strict';

const { logger } = require('./logger');
const { createErrorEmbed, createRateLimitEmbed, EMOJI } = require('./embeds');
const { ValidationError } = require('./validation');

/**
 * One place that knows how to talk back to Discord.
 *
 * Interactions have four possible states (fresh, deferred, replied, expired)
 * and every command would otherwise re-implement the same branching. Anything
 * that throws in here is swallowed and logged: failing to *report* a failure
 * must never take the bot down.
 */

/** Sends or edits, whichever the interaction state calls for. */
async function respond(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(payload);
    }
    return await interaction.reply(payload);
  } catch (error) {
    // 10062 = Unknown interaction (expired), 40060 = already acknowledged.
    if (error.code === 10062 || error.code === 40060) {
      logger.warn('Interaction expired before we could answer', {
        command: interaction.commandName,
        code: error.code,
      });
      return null;
    }
    logger.error('Failed to respond to interaction', { command: interaction.commandName, error });
    return null;
  }
}

/** Sends a brand-new follow-up message, used by component handlers. */
async function followUp(interaction, payload) {
  try {
    return await interaction.followUp(payload);
  } catch (error) {
    if (error.code === 10062 || error.code === 40060) return null;
    logger.error('Failed to follow up on interaction', { command: interaction.commandName, error });
    return null;
  }
}

/**
 * Acknowledges the interaction so Discord's three-second window cannot expire
 * while a command talks to a sandbox or an external API.
 */
async function defer(interaction, { ephemeral = false } = {}) {
  if (interaction.deferred || interaction.replied) return true;
  try {
    await interaction.deferReply({ ephemeral });
    return true;
  } catch (error) {
    if (error.code === 10062) {
      logger.warn('Interaction expired before it could be deferred', { command: interaction.commandName });
      return false;
    }
    logger.error('Failed to defer interaction', { command: interaction.commandName, error });
    return false;
  }
}

/**
 * Turns any thrown value into a friendly embed.
 * Stack traces go to the logs, never to the user.
 */
async function fail(interaction, error, { context = {}, ephemeral = true } = {}) {
  const isUserFacing = error instanceof ValidationError || error?.userFacing === true;

  if (isUserFacing) {
    logger.debug('Command rejected user input', { command: interaction.commandName, reason: error.message, ...context });
  } else {
    logger.error('Command failed', { command: interaction.commandName, error, ...context });
  }

  const embed = isUserFacing
    ? createErrorEmbed({
        title: error.title || "That didn't work",
        description: error.message,
        fields: error.hint ? [{ name: `${EMOJI.info} Hint`, value: String(error.hint) }] : undefined,
      })
    : createErrorEmbed({});

  const payload = { embeds: [embed], components: [] };
  if (!interaction.deferred && !interaction.replied) payload.ephemeral = ephemeral;
  return respond(interaction, payload);
}

/** Standard reply for a rate-limited command. */
async function rateLimited(interaction, retryAfterMs, what) {
  const payload = { embeds: [createRateLimitEmbed(retryAfterMs, what)] };
  if (!interaction.deferred && !interaction.replied) payload.ephemeral = true;
  return respond(interaction, payload);
}

module.exports = { respond, followUp, defer, fail, rateLimited };
