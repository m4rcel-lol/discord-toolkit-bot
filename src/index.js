'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  Discord gateway identification.
//
//  This MUST run before the Client is constructed and before login, because
//  discord.js reads DefaultWebSocketManagerOptions when it builds its
//  WebSocketManager. Mutating it afterwards would have no effect.
//  `require('./config')` comes first only so that DISCORD_IDENTIFY_BROWSER is
//  read out of .env — it creates no client and opens no socket.
// ─────────────────────────────────────────────────────────────────────────────
const { config, validateConfig } = require('./config');

const {
    DefaultWebSocketManagerOptions: {
        identifyProperties
    }
} = require("@discordjs/ws");

identifyProperties.browser = "Discord Android"; // or "Discord iOS"

// Honour DISCORD_IDENTIFY_BROWSER when the operator picked the other one.
identifyProperties.browser = config.discord.identifyBrowser;

// ─────────────────────────────────────────────────────────────────────────────

const { Client, GatewayIntentBits, ActivityType, Events, Partials } = require('discord.js');

const { logger } = require('./utils/logger');
const { RateLimiterRegistry } = require('./utils/rateLimit');
const { loadCommands } = require('./handlers/commandLoader');
const { createInteractionHandler } = require('./handlers/interactionHandler');
const { deployCommands, inviteUrl } = require('./deploy-commands');
const { startHeartbeat } = require('./health');
const luau = require('./services/luau');

/**
 * m5rcel's tool doggy — process entry point.
 *
 * Intents: `Guilds` only. The bot reads no message content, needs no privileged
 * intent, and asks for zero Discord permissions; everything it does happens
 * through interactions.
 */

function buildRateLimiters() {
  const registry = new RateLimiterRegistry();
  registry.register('default', config.rateLimits.default);
  registry.register('luau', config.rateLimits.luau);
  registry.register('qrDecode', config.rateLimits.qrDecode);
  registry.register('wiki', config.rateLimits.wiki);
  return registry;
}

function banner(commandNames) {
  return (
    `\n  🐶🧰  ${config.branding.name} v${config.branding.version}\n` +
    `      commands  ${commandNames.map((name) => `/${name}`).join(' ')}\n` +
    `      invite    ${inviteUrl()}\n\n`
  );
}

async function main() {
  const problems = validateConfig('bot');
  if (problems.length) {
    for (const problem of problems) logger.error('Configuration problem', { problem });
    process.stderr.write(
      '\n  ✖ The bot cannot start. Copy .env.example to .env and fill in the missing values.\n\n',
    );
    process.exit(1);
  }

  const { commands, problems: commandProblems } = loadCommands();
  for (const problem of commandProblems) logger.error('Command definition problem', { problem });
  if (commandProblems.length) {
    process.stderr.write('\n  ✖ One or more command files are broken; refusing to start.\n\n');
    process.exit(1);
  }
  logger.info('Loaded commands', { count: commands.size, names: [...commands.keys()] });

  const rateLimiters = buildRateLimiters();

  let stopHeartbeat = () => {};

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    // Needed so interactions arriving in a DM the bot has never seen still
    // resolve their channel instead of arriving half-empty.
    partials: [Partials.Channel],
    allowedMentions: { parse: [] },
    presence: {
      status: 'online',
      activities: [{ name: '/toolkit', type: ActivityType.Listening }],
    },
  });

  client.commands = commands;
  client.on(Events.InteractionCreate, createInteractionHandler({ commands, rateLimiters }));

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info('Logged in', {
      user: readyClient.user.tag,
      userId: readyClient.user.id,
      guilds: readyClient.guilds.cache.size,
      identifyBrowser: identifyProperties.browser,
    });
    process.stdout.write(banner([...commands.keys()]));
    stopHeartbeat = startHeartbeat(readyClient);

    if (config.discord.autoDeploy) {
      try {
        const result = await deployCommands();
        logger.info('Slash commands registered at startup', { scope: result.scope, count: result.registered });
      } catch (error) {
        // A registration failure is loud, but it must not stop a bot that is
        // otherwise perfectly able to serve already-registered commands.
        logger.error('Automatic command registration failed — run `npm run deploy` manually', { error });
      }
    }

    const health = await luau.health({ timeoutMs: 4000 });
    if (health.ok) logger.info('Luau sandbox reachable', { queue: health.queue });
    else logger.warn('Luau sandbox is not reachable — /luau will report it as offline', { detail: health });
  });

  client.on(Events.Error, (error) => logger.error('Discord client error', { error }));
  client.on(Events.ShardError, (error, shardId) => logger.error('Shard error', { shardId, error }));
  client.on(Events.ShardDisconnect, (event, shardId) => logger.warn('Shard disconnected', { shardId, code: event?.code }));
  client.on(Events.ShardReconnecting, (shardId) => logger.info('Shard reconnecting', { shardId }));
  client.on(Events.ShardResume, (shardId) => logger.info('Shard resumed', { shardId }));
  client.on(Events.Warn, (message) => logger.warn('Discord client warning', { message }));

  // ── graceful shutdown ─────────────────────────────────────────────────────
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down', { signal });
    try {
      stopHeartbeat();
      luau.shutdown();
      await client.destroy();
    } catch (error) {
      logger.error('Error while shutting down', { error });
    }
    // Give the logger a tick to flush, then leave.
    setTimeout(() => process.exit(0), 250).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // A bug in one command must never take the whole bot down.
  process.on('unhandledRejection', (reason) => logger.error('Unhandled promise rejection', { error: reason }));
  process.on('uncaughtException', (error) => logger.error('Uncaught exception', { error }));

  try {
    await client.login(config.discord.token);
  } catch (error) {
    logger.error('Login failed', { error });
    process.stderr.write('\n  ✖ Could not log in. Check DISCORD_TOKEN.\n\n');
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { main };
