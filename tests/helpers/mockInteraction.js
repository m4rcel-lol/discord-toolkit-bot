'use strict';

/**
 * A minimal stand-in for a discord.js ChatInputCommandInteraction.
 *
 * Enough surface for a command to run for real — options, deferral, replies,
 * modals — while recording everything it sends so tests can inspect the actual
 * embeds instead of trusting that a command "probably works".
 */
function createMockInteraction({
  commandName,
  subcommand = null,
  options = {},
  attachments = {},
  userId = '111111111111111111',
  guildId = '222222222222222222',
  focused = null,
} = {}) {
  const sent = [];
  const modals = [];
  const autocompleteChoices = [];

  const get = (name) => (Object.prototype.hasOwnProperty.call(options, name) ? options[name] : null);

  const interaction = {
    commandName,
    guildId,
    deferred: false,
    replied: false,
    user: { id: userId, tag: 'tester#0001' },
    client: { ws: { ping: 42 }, guilds: { cache: { size: 3 } }, isReady: () => true },
    channel: guildId ? { type: 0 } : { type: 1 },

    inGuild: () => Boolean(guildId),

    options: {
      getSubcommand: (required = true) => {
        if (subcommand === null && required) throw new Error('no subcommand');
        return subcommand;
      },
      getString: (name) => {
        const value = get(name);
        return value === null || value === undefined ? null : String(value);
      },
      getBoolean: (name) => {
        const value = get(name);
        return value === null || value === undefined ? null : Boolean(value);
      },
      getInteger: (name) => {
        const value = get(name);
        return value === null || value === undefined ? null : Number(value);
      },
      getAttachment: (name) => attachments[name] ?? null,
      getFocused: (asObject = false) => (asObject ? focused : (focused?.value ?? '')),
    },

    async deferReply(payload = {}) {
      if (this.deferred || this.replied) throw new Error('already acknowledged');
      this.deferred = true;
      sent.push({ type: 'defer', ...payload });
      return this;
    },
    async reply(payload) {
      if (this.deferred || this.replied) throw new Error('already acknowledged');
      this.replied = true;
      sent.push({ type: 'reply', ...payload });
      return this;
    },
    async editReply(payload) {
      sent.push({ type: 'editReply', ...payload });
      this.replied = true;
      return this;
    },
    async followUp(payload) {
      sent.push({ type: 'followUp', ...payload });
      return this;
    },
    async update(payload) {
      this.deferred = true;
      sent.push({ type: 'update', ...payload });
      return this;
    },
    async deferUpdate() {
      this.deferred = true;
      sent.push({ type: 'deferUpdate' });
      return this;
    },
    async showModal(modal) {
      modals.push(modal);
      this.replied = true;
      return this;
    },
    async respond(choices) {
      autocompleteChoices.push(choices);
      return this;
    },

    // Test-only accessors.
    sent,
    modals,
    autocompleteChoices,
    /** The final message payload the user would actually see. */
    result() {
      return [...sent].reverse().find((entry) => entry.embeds || entry.files) || null;
    },
    embeds() {
      const result = this.result();
      return (result?.embeds || []).map((embed) => (typeof embed.toJSON === 'function' ? embed.toJSON() : embed));
    },
  };

  return interaction;
}

module.exports = { createMockInteraction };
