'use strict';

const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  AttachmentBuilder,
} = require('discord.js');

const luau = require('../services/luau');
const { limits, describeLimits } = require('../sandbox/limits');
const { createResultEmbed, createErrorEmbed, codeBlock, EMOJI, COLORS, truncate } = require('../utils/embeds');
const { respond, defer, fail, rateLimited } = require('../utils/respond');
const { humanBytes, humanDuration } = require('../utils/format');
const { logger } = require('../utils/logger');

/**
 * `/luau` — the toolkit's flagship feature.
 *
 * The bot itself never evaluates a single line of the submitted program: the
 * source is validated, queued, and handed to a separate hardened container.
 * See `src/services/luau/index.js` and `worker/` for the isolation details.
 */

const OUTPUT_FIELD_LIMIT = 900;

/** Long output is nicer as an attachment than as a truncated field. */
function outputAttachment(text, name) {
  return new AttachmentBuilder(Buffer.from(text, 'utf8'), { name });
}

function statusLine(result) {
  switch (result.status) {
    case 'success': return `${EMOJI.green} Success`;
    case 'timeout': return `${EMOJI.yellow} Timed out`;
    case 'output_limit': return `${EMOJI.yellow} Output limit reached`;
    case 'compile_error': return `${EMOJI.red} Compilation failed`;
    case 'runtime_error': return `${EMOJI.red} Runtime error`;
    default: return `${EMOJI.red} Failed`;
  }
}

function buildRunEmbed(result) {
  const files = [];
  const fields = [];

  const colour =
    result.status === 'success' ? COLORS.success :
    result.status === 'timeout' || result.status === 'output_limit' ? COLORS.warning : COLORS.error;

  if (result.status === 'timeout') {
    return {
      embed: createResultEmbed({
        emoji: EMOJI.developer,
        title: 'Luau Execution',
        color: COLORS.warning,
        description:
          `${EMOJI.timer} **Execution timed out.**\n\n` +
          `The program exceeded the ${humanDuration(result.limitMs ?? limits.timeoutMs)} execution limit.`,
        fields: [
          ...(result.stdout ? [{ name: 'Output before the timeout', value: codeBlock(result.stdout, 'ansi', OUTPUT_FIELD_LIMIT) }] : []),
          { name: 'Status', value: statusLine(result), inline: true },
        ],
      }),
      files,
    };
  }

  if (result.status === 'output_limit') {
    return {
      embed: createResultEmbed({
        emoji: EMOJI.developer,
        title: 'Luau Execution',
        color: COLORS.warning,
        description:
          `${EMOJI.warning} **Output limit reached.**\n\n` +
          `The program printed more than ${humanBytes(result.limitBytes ?? limits.maxOutput)} and was stopped.`,
        fields: [
          ...(result.stdout ? [{ name: 'Output (truncated)', value: codeBlock(result.stdout, '', OUTPUT_FIELD_LIMIT) }] : []),
          { name: 'Status', value: statusLine(result), inline: true },
        ],
      }),
      files,
    };
  }

  if (result.status === 'compile_error' || result.status === 'runtime_error') {
    const diagnostic = result.diagnostic;
    const isCompile = result.status === 'compile_error';
    const heading = isCompile
      ? `${EMOJI.red} **Compilation failed**`
      : `${EMOJI.red} **Runtime error**`;

    const location = diagnostic?.line
      ? `**Line ${diagnostic.line}${diagnostic.column ? `, column ${diagnostic.column}` : ''}:**\n`
      : '';
    const message = diagnostic?.message || result.stderr || 'The program stopped with an error.';

    if (result.stdout) {
      fields.push({ name: 'Output before the error', value: codeBlock(result.stdout, '', OUTPUT_FIELD_LIMIT) });
    }
    if (result.memoryExceeded) {
      fields.push({
        name: `${EMOJI.warning} Memory`,
        value: `The program was stopped after exceeding the ${limits.memoryMb} MiB limit.`,
      });
    }
    fields.push({ name: 'Status', value: statusLine(result), inline: true });
    fields.push({ name: 'Execution time', value: humanDuration(result.durationMs), inline: true });

    return {
      embed: createResultEmbed({
        emoji: EMOJI.developer,
        title: isCompile ? 'Luau Compilation' : 'Luau Execution',
        color: COLORS.error,
        description: `${heading}\n\n${location}${codeBlock(truncate(message, 1500), '', 1800)}`,
        fields,
      }),
      files,
    };
  }

  // Success.
  const output = result.stdout?.trim() ? result.stdout : '(the program produced no output)';
  if (output.length > OUTPUT_FIELD_LIMIT) {
    files.push(outputAttachment(output, 'luau-output.txt'));
    fields.push({ name: 'Output', value: codeBlock(output.slice(0, OUTPUT_FIELD_LIMIT), '', OUTPUT_FIELD_LIMIT + 20) });
    fields.push({ name: '​', value: '📎 The full output is attached above.' });
  } else {
    fields.push({ name: 'Output', value: codeBlock(output, '', OUTPUT_FIELD_LIMIT + 20) });
  }

  if (result.stderr?.trim()) {
    fields.push({ name: 'Standard error', value: codeBlock(result.stderr, '', OUTPUT_FIELD_LIMIT) });
  }

  fields.push({ name: 'Execution time', value: humanDuration(result.durationMs), inline: true });
  fields.push({ name: 'Status', value: statusLine(result), inline: true });
  fields.push({ name: 'Source', value: `${result.sourceLines} lines · ${humanBytes(result.sourceBytes)}`, inline: true });

  return {
    embed: createResultEmbed({
      emoji: EMOJI.developer,
      title: 'Luau Execution',
      color: colour,
      fields,
      footer: 'Sandboxed · no network · no filesystem',
    }),
    files,
  };
}

function buildCompileEmbed(result) {
  if (result.status === 'timeout') {
    return createResultEmbed({
      emoji: EMOJI.developer,
      title: 'Luau Compilation',
      color: COLORS.warning,
      description: `${EMOJI.timer} The analyser took too long and was stopped.`,
    });
  }

  const errors = result.syntaxErrors || [];
  const warnings = result.warnings || [];

  if (errors.length) {
    const rendered = errors
      .slice(0, 6)
      .map((diagnostic) => `**Line ${diagnostic.line}${diagnostic.column ? `, column ${diagnostic.column}` : ''}:**\n${diagnostic.message}`)
      .join('\n\n');

    return createResultEmbed({
      emoji: EMOJI.developer,
      title: 'Luau Compilation',
      color: COLORS.error,
      description: `${EMOJI.red} **Compilation failed**\n\n${truncate(rendered, 3500)}`,
      fields: [
        { name: 'Errors', value: String(errors.length), inline: true },
        { name: 'Source', value: `${result.lines} lines · ${humanBytes(result.bytes)}`, inline: true },
        { name: 'Status', value: `${EMOJI.red} Failed`, inline: true },
      ],
    });
  }

  const fields = [
    { name: 'Source', value: `${result.lines} lines · ${humanBytes(result.bytes)}`, inline: true },
    { name: 'Analysis time', value: humanDuration(result.durationMs), inline: true },
    { name: 'Status', value: `${EMOJI.green} Compiles cleanly`, inline: true },
  ];

  if (warnings.length) {
    const rendered = warnings
      .slice(0, 8)
      .map((diagnostic) => `\`L${diagnostic.line}\` **${diagnostic.category}** — ${diagnostic.message}`)
      .join('\n');
    fields.push({ name: `${EMOJI.warning} Analyser notes (${warnings.length})`, value: truncate(rendered, 1000) });
  }

  return createResultEmbed({
    emoji: EMOJI.developer,
    title: 'Luau Compilation',
    color: warnings.length ? COLORS.warning : COLORS.success,
    description: warnings.length
      ? `${EMOJI.green} **No syntax errors.** The analyser has a few notes for you.`
      : `${EMOJI.green} **No problems found.**`,
    fields,
  });
}

function codeModal(kind) {
  return new ModalBuilder()
    .setCustomId(`modal:luau:${kind}`)
    .setTitle(kind === 'compile' ? 'Check Luau code' : 'Run Luau code')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('source')
          .setLabel('Luau source')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('local dog = "m5rcel\'s tool doggy"\nprint("Hello from " .. dog)')
          .setRequired(true)
          .setMaxLength(4000),
      ),
    );
}

/** Shared by the slash command and the modal submission. */
async function executeJob(interaction, { kind, source, isPrivate }) {
  if (!(await defer(interaction, { ephemeral: isPrivate }))) return;

  try {
    const result = kind === 'compile'
      ? await luau.compile(source, { guildId: interaction.guildId })
      : await luau.run(source, { guildId: interaction.guildId });

    if (kind === 'compile') {
      return await respond(interaction, { embeds: [buildCompileEmbed(result)] });
    }
    const { embed, files } = buildRunEmbed(result);
    return await respond(interaction, { embeds: [embed], files });
  } catch (error) {
    if (error.code === 'QUEUE_FULL' || error.code === 'QUEUE_TIMEOUT' || error.code === 'WORKER_BUSY') {
      return respond(interaction, {
        embeds: [
          createErrorEmbed({
            title: 'The sandbox is busy',
            description: 'Too many programs are running right now. Give it a few seconds and try again.',
          }),
        ],
      });
    }
    return fail(interaction, error, { context: { kind } });
  }
}

module.exports = {
  category: 'developer',
  rateLimit: 'luau',
  rateLimitLabel: 'the Luau sandbox',

  data: new SlashCommandBuilder()
    .setName('luau')
    .setDescription('Run and check Luau code in a locked-down sandbox.')
    .setDMPermission(true)
    .addSubcommand((sub) =>
      sub
        .setName('run')
        .setDescription('Execute a Luau program and show its output.')
        .addStringOption((option) =>
          option.setName('code').setDescription('The Luau code (leave empty to open a multi-line editor)').setRequired(false),
        )
        .addBooleanOption((option) =>
          option.setName('private').setDescription('Only you can see the result').setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('compile')
        .setDescription('Syntax- and type-check Luau without running it.')
        .addStringOption((option) =>
          option.setName('code').setDescription('The Luau code (leave empty to open a multi-line editor)').setRequired(false),
        )
        .addBooleanOption((option) =>
          option.setName('private').setDescription('Only you can see the result').setRequired(false),
        ),
    )
    .addSubcommand((sub) => sub.setName('limits').setDescription('Show the sandbox limits and worker status.')),

  /**
   * Rate limiting is skipped in two cases:
   *   - `/luau limits`, which costs nothing and is exactly what people check
   *     right after being told to slow down;
   *   - the modal path (no `code` option), because opening an editor runs
   *     nothing — the submission is charged instead, so one execution is
   *     never billed twice.
   */
  skipRateLimit(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'limits') return true;
    return !interaction.options.getString('code');
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'limits') {
      const health = await luau.health({ timeoutMs: 2500 });
      const queue = luau.stats().queue;
      return respond(interaction, {
        ephemeral: true,
        embeds: [
          createResultEmbed({
            emoji: EMOJI.developer,
            title: 'Luau sandbox',
            color: health.ok ? COLORS.success : COLORS.error,
            description: health.ok
              ? `${EMOJI.green} The sandbox is online.\n\nEvery program runs in a disposable container with no network access, ` +
                'no filesystem access and no secrets.'
              : `${EMOJI.red} The sandbox is unreachable right now. \`/luau run\` will not work until it is back.`,
            fields: [
              ...describeLimits(),
              { name: 'Queue', value: `${queue.active} running · ${queue.waiting} waiting`, inline: true },
            ],
            footer: 'Limits are set by the operator and cannot be disabled',
          }),
        ],
      });
    }

    const code = interaction.options.getString('code');
    const isPrivate = interaction.options.getBoolean('private') ?? false;

    // No code supplied: open a proper multi-line editor instead of forcing
    // people to write Luau on one line. A modal must be the first response,
    // so nothing may be deferred before this point.
    if (!code) {
      try {
        await interaction.showModal(codeModal(sub));
        return undefined;
      } catch (error) {
        logger.error('Failed to open the Luau modal', { error });
        return fail(interaction, error);
      }
    }

    return executeJob(interaction, { kind: sub, source: code, isPrivate });
  },

  /** Handles submissions from the multi-line code modal. */
  async handleModal(interaction, { action, rateLimiters }) {
    const source = interaction.fields.getTextInputValue('source');
    const check = rateLimiters.consume('luau', interaction.user.id);
    if (!check.allowed) return rateLimited(interaction, check.retryAfterMs, 'the Luau sandbox');
    return executeJob(interaction, { kind: action === 'compile' ? 'compile' : 'run', source, isPrivate: false });
  },

  buildRunEmbed,
  buildCompileEmbed,
};
