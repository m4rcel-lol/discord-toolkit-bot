'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Collection } = require('discord.js');

const { logger } = require('../utils/logger');

/**
 * Loads every command module in `src/commands`.
 *
 * A command module must export `data` (a SlashCommandBuilder) and `execute`.
 * Optional: `autocomplete`, `handleComponent`, `handleModal`, `category`,
 * `rateLimit`, `rateLimitFor(interaction)`, `skipRateLimit(interaction)`.
 */
function loadCommands(directory = path.join(__dirname, '..', 'commands')) {
  const commands = new Collection();
  const problems = [];

  const files = fs
    .readdirSync(directory)
    .filter((file) => file.endsWith('.js') && !file.startsWith('_'))
    .sort();

  for (const file of files) {
    const fullPath = path.join(directory, file);
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const command = require(fullPath);

      if (!command?.data || typeof command.execute !== 'function') {
        problems.push(`${file} does not export both \`data\` and \`execute\``);
        continue;
      }

      const name = command.data.name;
      if (commands.has(name)) {
        problems.push(`duplicate command name \`${name}\` in ${file}`);
        continue;
      }

      commands.set(name, { ...command, file });
      logger.debug('Loaded command', { command: name, file });
    } catch (error) {
      problems.push(`${file} failed to load: ${error.message}`);
      logger.error('Failed to load command file', { file, error });
    }
  }

  return { commands, problems };
}

/** The JSON payload sent to Discord's application-command endpoint. */
function toRegistrationPayload(commands, { userInstall = false } = {}) {
  return [...commands.values()].map((command) => {
    const json = command.data.toJSON();

    // `contexts` supersedes the older `dm_permission` flag and is what makes a
    // command usable in servers (0), private DMs with the bot (1) and group
    // DMs (2). Sending both at once is rejected by the API.
    delete json.dm_permission;
    json.contexts = [0, 1, 2];

    // 0 = installed to a guild, 1 = installed to a user account. User install
    // has to be enabled for the application first, so it is opt-in.
    json.integration_types = userInstall ? [0, 1] : [0];

    return json;
  });
}

module.exports = { loadCommands, toRegistrationPayload };
