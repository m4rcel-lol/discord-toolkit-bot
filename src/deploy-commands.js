'use strict';

const { REST, Routes } = require('discord.js');

const { config, validateConfig } = require('./config');
const { logger } = require('./utils/logger');
const { loadCommands, toRegistrationPayload } = require('./handlers/commandLoader');

/**
 * Slash-command registration.
 *
 * Used both by `npm run deploy` and — unless DISCORD_AUTO_DEPLOY=false — by the
 * bot itself at startup, so a fresh `docker compose up -d` has working commands
 * with no extra steps.
 */

/**
 * @param {object} [options]
 * @param {boolean} [options.clear]   remove every command instead of registering
 * @param {string}  [options.guildId] register to one guild (instant) rather than globally
 * @returns {Promise<{ registered: number, scope: string }>}
 */
async function deployCommands({ clear = false, guildId = config.discord.guildId } = {}) {
  const { commands, problems } = loadCommands();
  for (const problem of problems) logger.error('Command definition problem', { problem });
  if (problems.length) throw new Error(`${problems.length} command file(s) could not be loaded.`);

  const body = clear ? [] : toRegistrationPayload(commands, { userInstall: config.discord.userInstall });
  const rest = new REST({ version: '10' }).setToken(config.discord.token);

  const route = guildId
    ? Routes.applicationGuildCommands(config.discord.clientId, guildId)
    : Routes.applicationCommands(config.discord.clientId);
  const scope = guildId ? `guild ${guildId}` : 'global';

  const result = await rest.put(route, { body });

  logger.info(clear ? 'Cleared application commands' : 'Registered application commands', {
    scope,
    count: Array.isArray(result) ? result.length : 0,
    userInstall: config.discord.userInstall,
  });

  return { registered: Array.isArray(result) ? result.length : 0, scope, names: [...commands.keys()] };
}

/** The invite link an operator should use. Note: zero permissions requested. */
function inviteUrl() {
  return (
    'https://discord.com/api/oauth2/authorize' +
    `?client_id=${encodeURIComponent(config.discord.clientId)}` +
    '&scope=bot%20applications.commands' +
    '&permissions=0'
  );
}

async function main() {
  const problems = validateConfig('deploy');
  if (problems.length) {
    for (const problem of problems) logger.error('Configuration problem', { problem });
    process.exitCode = 1;
    return;
  }

  const clear = process.argv.includes('--clear');
  const guildFlag = process.argv.indexOf('--guild');
  const guildId = guildFlag !== -1 ? process.argv[guildFlag + 1] : config.discord.guildId;

  try {
    const result = await deployCommands({ clear, guildId });
    if (clear) {
      process.stdout.write(`\n  ✔ Cleared all ${result.scope} commands.\n\n`);
      return;
    }
    process.stdout.write(
      `\n  ✔ Registered ${result.registered} commands (${result.scope}):\n` +
        `    ${result.names.map((name) => `/${name}`).join('  ')}\n\n` +
        `  Invite the bot with:\n    ${inviteUrl()}\n\n` +
        (result.scope === 'global'
          ? '  Global commands can take up to an hour to appear the first time.\n' +
            '  Set DISCORD_GUILD_ID in .env for instant registration while developing.\n\n'
          : ''),
    );
  } catch (error) {
    logger.error('Command registration failed', { error });
    process.stdout.write(
      '\n  ✖ Registration failed. Check that DISCORD_TOKEN and DISCORD_CLIENT_ID belong to the same application.\n\n',
    );
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { deployCommands, inviteUrl };
