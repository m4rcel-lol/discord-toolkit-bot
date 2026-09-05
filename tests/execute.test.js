'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadCommands } = require('../src/handlers/commandLoader');
const { createInteractionHandler } = require('../src/handlers/interactionHandler');
const { RateLimiterRegistry } = require('../src/utils/rateLimit');
const { createMockInteraction } = require('./helpers/mockInteraction');
const { LIMITS } = require('../src/utils/embeds');

/**
 * Runs every command for real through a mock interaction and inspects what a
 * user would actually see. This is the test that would fail if any command
 * were a stub.
 */

const { commands } = loadCommands();

function rateLimiters() {
  const registry = new RateLimiterRegistry();
  registry.register('default', { uses: 1000, windowMs: 1000 });
  registry.register('luau', { uses: 1000, windowMs: 1000 });
  registry.register('qrDecode', { uses: 1000, windowMs: 1000 });
  registry.register('wiki', { uses: 1000, windowMs: 1000 });
  return registry;
}

async function run(spec) {
  const interaction = createMockInteraction(spec);
  const command = commands.get(spec.commandName);
  assert.ok(command, `/${spec.commandName} should exist`);
  await command.execute(interaction, { commands, rateLimiters: rateLimiters() });
  return interaction;
}

/** Asserts the reply is a well-formed, non-empty, in-limits embed. */
function assertGoodEmbed(interaction, label) {
  const embeds = interaction.embeds();
  assert.equal(embeds.length >= 1, true, `${label}: expected an embed`);
  const [embed] = embeds;

  assert.ok(embed.title || embed.description, `${label}: an embed needs a title or a description`);
  assert.ok(embed.timestamp, `${label}: every embed carries a timestamp`);
  assert.match(embed.footer.text, /m5rcel's tool doggy/, `${label}: branded footer`);
  assert.equal(typeof embed.color, 'number', `${label}: embeds are coloured`);

  if (embed.title) assert.ok(embed.title.length <= LIMITS.title, `${label}: title too long`);
  if (embed.description) assert.ok(embed.description.length <= LIMITS.description, `${label}: description too long`);
  for (const field of embed.fields || []) {
    assert.ok(field.name.length > 0 && field.name.length <= LIMITS.fieldName, `${label}: bad field name`);
    assert.ok(field.value.length > 0 && field.value.length <= LIMITS.fieldValue, `${label}: bad field value`);
  }
  assert.ok((embed.fields || []).length <= LIMITS.fields, `${label}: too many fields`);

  // Nothing internal ever reaches the user.
  const rendered = JSON.stringify(embed);
  assert.doesNotMatch(rendered, /node_modules|\/Users\/|at Object\.<anonymous>/, `${label}: leaked internals`);
  return embed;
}

test('/toolkit renders the homepage and every category', async () => {
  const home = await run({ commandName: 'toolkit' });
  const embed = assertGoodEmbed(home, '/toolkit');
  assert.match(embed.title, /tool doggy/);
  assert.equal(embed.fields.length, 6, 'six categories');
  assert.equal(home.result().ephemeral, true, 'the homepage is private by default');
  assert.equal(home.result().components.length, 2, 'a select menu and a button row');

  for (const category of ['developer', 'calculator', 'colors', 'qr', 'wikipedia', 'utilities']) {
    const page = await run({ commandName: 'toolkit', options: { category } });
    assert.ok(assertGoodEmbed(page, `/toolkit ${category}`).fields.length > 0);
  }
});

test('/calc produces a real answer for every documented example', async () => {
  const cases = [
    ['5 * (20 + 3)', '115'],
    ['2^32', '4\u2009294\u2009967\u2009296'],
    ['sqrt(144)', '12'],
    ['255 to binary', '11111111'],
    ['1 GiB to bytes', '1\u2009073\u2009741\u2009824 B'],
    ['100 C to F', '212 F'],
    ['50% of 200', '100'],
  ];
  for (const [expression, expected] of cases) {
    const interaction = await run({ commandName: 'calc', options: { expression } });
    const embed = assertGoodEmbed(interaction, `/calc ${expression}`);
    assert.ok(embed.description.includes(expected), `/calc ${expression} should show ${expected}, got: ${embed.description}`);
  }
});

test('/calc reports bad input as a friendly error, privately', async () => {
  const interaction = await run({ commandName: 'calc', options: { expression: '1 +' } });
  const embed = assertGoodEmbed(interaction, '/calc invalid');
  assert.match(embed.title, /❌/);
  assert.equal(interaction.result().ephemeral, true);
});

test('/calc autocomplete previews the expression and completes names', async () => {
  const command = commands.get('calc');
  const interaction = createMockInteraction({ commandName: 'calc', focused: { name: 'expression', value: '2+2' } });
  await command.autocomplete(interaction);
  const [choices] = interaction.autocompleteChoices;
  assert.ok(choices.length > 0);
  assert.match(choices[0].name, /= 4/, 'the first choice previews the result');
  for (const choice of choices) {
    assert.ok(choice.name.length <= 100 && choice.value.length <= 100, 'autocomplete entries fit Discord limits');
  }

  const partial = createMockInteraction({ commandName: 'calc', focused: { name: 'expression', value: 'sq' } });
  await command.autocomplete(partial);
  assert.ok(partial.autocompleteChoices[0].some((choice) => choice.value.includes('sqrt(')));
});

test('/color convert, contrast and palette all render with an image', async () => {
  const convert = await run({ commandName: 'color', subcommand: 'convert', options: { color: '#FF6600' } });
  const convertEmbed = assertGoodEmbed(convert, '/color convert');
  const names = convertEmbed.fields.map((field) => field.name);
  assert.deepEqual(names.slice(0, 5), ['HEX', 'RGB', 'HSL', 'HSV', 'CMYK']);
  assert.equal(convertEmbed.fields[0].value, '`#FF6600`');
  assert.equal(convertEmbed.fields[1].value, '`255, 102, 0`');
  assert.equal(convertEmbed.fields[2].value, '`24°, 100%, 50%`');
  assert.equal(convertEmbed.fields[3].value, '`24°, 100%, 100%`');
  assert.equal(convert.result().files.length, 1, 'a swatch is attached');

  const contrast = await run({
    commandName: 'color',
    subcommand: 'contrast',
    options: { foreground: '#FFFFFF', background: '#FF6600' },
  });
  const contrastEmbed = assertGoodEmbed(contrast, '/color contrast');
  assert.match(contrastEmbed.description, /2\.94:1/);
  assert.match(contrastEmbed.fields.at(-1).value, /❌ \*\*AA · normal text\*\*/);

  const palette = await run({
    commandName: 'color',
    subcommand: 'palette',
    options: { color: '#FF6600', scheme: 'triadic' },
  });
  const paletteEmbed = assertGoodEmbed(palette, '/color palette');
  assert.match(paletteEmbed.fields[0].value, /#00FF66/);
  assert.equal(palette.result().files.length, 1, 'a palette image is attached');
});

test('/qr create makes a scannable code', async () => {
  const interaction = await run({
    commandName: 'qr',
    subcommand: 'create',
    options: { value: 'https://example.com', type: 'url' },
  });
  const embed = assertGoodEmbed(interaction, '/qr create');
  assert.equal(interaction.result().files.length, 1);
  assert.match(embed.fields.at(-1).value, /https:\/\/example\.com/);

  const { decodeQr } = require('../src/services/qr');
  const attachment = interaction.result().files[0];
  const decoded = await decodeQr(attachment.attachment);
  assert.equal(decoded.data, 'https://example.com');
});

test('/qr create guesses the type when none is given', async () => {
  const url = await run({ commandName: 'qr', subcommand: 'create', options: { value: 'example.com/x' } });
  assert.match(assertGoodEmbed(url, '/qr guess url').fields[0].value, /URL/);

  const plain = await run({ commandName: 'qr', subcommand: 'create', options: { value: 'just some words' } });
  assert.match(assertGoodEmbed(plain, '/qr guess text').fields[0].value, /Plain text/);
});

test('/json handles all four subcommands', async () => {
  const format = await run({ commandName: 'json', subcommand: 'format', options: { json: '{"b":1,"a":2}', sort_keys: true } });
  assert.match(assertGoodEmbed(format, '/json format').fields[0].value, /"a": 2/);

  const minify = await run({ commandName: 'json', subcommand: 'minify', options: { json: '{ "a" : 1 }' } });
  assert.match(assertGoodEmbed(minify, '/json minify').fields[0].value, /\{"a":1\}/);

  const valid = await run({ commandName: 'json', subcommand: 'validate', options: { json: '{"a":1}' } });
  assert.match(assertGoodEmbed(valid, '/json validate').title, /valid/i);

  const invalid = await run({ commandName: 'json', subcommand: 'validate', options: { json: '{"a":1,}' } });
  assert.match(assertGoodEmbed(invalid, '/json invalid').description, /line 1/);

  const diff = await run({ commandName: 'json', subcommand: 'diff', options: { first: '{"a":1}', second: '{"a":2}' } });
  assert.match(assertGoodEmbed(diff, '/json diff').description, /🟡 `a`/);

  const same = await run({ commandName: 'json', subcommand: 'diff', options: { first: '{"a":1}', second: '{"a":1}' } });
  assert.match(assertGoodEmbed(same, '/json same').description, /identical/);

  // A code block pasted straight from Discord must work too.
  const fenced = await run({ commandName: 'json', subcommand: 'format', options: { json: '```json\n{"a":1}\n```' } });
  assert.match(assertGoodEmbed(fenced, '/json fenced').fields[0].value, /"a": 1/);
});

test('/hash produces correct digests and flags the broken ones', async () => {
  const expected = {
    sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    sha512: '9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca72323c3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adef46f73bcdec043',
    sha1: 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d',
    md5: '5d41402abc4b2a76b9719d911017c592',
  };

  for (const [algorithm, digest] of Object.entries(expected)) {
    const interaction = await run({ commandName: 'hash', options: { text: 'hello', algorithm } });
    const embed = assertGoodEmbed(interaction, `/hash ${algorithm}`);
    assert.ok(embed.fields[0].value.includes(digest), `${algorithm} digest of "hello"`);
    assert.equal(interaction.result().ephemeral, true, 'hashing is private by default');

    const warning = embed.fields.find((field) => field.name.includes('Not for security'));
    if (algorithm === 'sha1' || algorithm === 'md5') {
      assert.ok(warning, `${algorithm} must be labelled as unsuitable for security`);
      assert.match(warning.value, /SHA-256/);
    } else {
      assert.equal(warning, undefined, `${algorithm} needs no warning`);
    }
  }
});

test('/base64 round trips and rejects garbage', async () => {
  const encoded = await run({ commandName: 'base64', subcommand: 'encode', options: { text: 'hello doggy' } });
  assert.match(assertGoodEmbed(encoded, '/base64 encode').fields[0].value, /aGVsbG8gZG9nZ3k=/);

  const decoded = await run({ commandName: 'base64', subcommand: 'decode', options: { data: 'aGVsbG8gZG9nZ3k=' } });
  assert.match(assertGoodEmbed(decoded, '/base64 decode').fields[0].value, /hello doggy/);

  const urlSafe = await run({ commandName: 'base64', subcommand: 'encode', options: { text: '???>>>', variant: 'base64url' } });
  assert.doesNotMatch(assertGoodEmbed(urlSafe, '/base64url').fields[0].value, /[+/]/);

  const bad = await run({ commandName: 'base64', subcommand: 'decode', options: { data: 'not valid base64!!' } });
  assert.match(assertGoodEmbed(bad, '/base64 bad').title, /❌/);
});

test('/uuid generates each flavour', async () => {
  const v4 = await run({ commandName: 'uuid' });
  assert.match(assertGoodEmbed(v4, '/uuid').fields[0].value, /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);

  const v7 = await run({ commandName: 'uuid', options: { version: 'v7', count: 5 } });
  const embed = assertGoodEmbed(v7, '/uuid v7');
  assert.equal(embed.fields[0].value.split('\n').filter((line) => line.includes('-')).length, 5);
  assert.match(embed.title, /5 ×/);

  const upper = await run({ commandName: 'uuid', options: { uppercase: true } });
  assert.match(assertGoodEmbed(upper, '/uuid upper').fields[0].value, /[0-9A-F]{8}-/);
});

test('/timestamp emits real Discord markup', async () => {
  const now = await run({ commandName: 'timestamp', subcommand: 'now' });
  const embed = assertGoodEmbed(now, '/timestamp now');
  const styles = embed.fields.filter((field) => field.value.includes('<t:'));
  assert.equal(styles.length, 7, 'all seven styles');
  for (const field of styles) assert.match(field.value, /<t:\d+:[tTdDfFR]>/);

  const at = await run({ commandName: 'timestamp', subcommand: 'at', options: { unix: 1700000000 } });
  assert.match(assertGoodEmbed(at, '/timestamp at').fields[0].value, /<t:1700000000:t>/);

  const bad = await run({ commandName: 'timestamp', subcommand: 'at', options: { date: 'sometime' } });
  assert.match(assertGoodEmbed(bad, '/timestamp bad').title, /❌/);
});

test('/text transforms and counts', async () => {
  const transformed = await run({
    commandName: 'text',
    subcommand: 'transform',
    options: { text: 'm5rcels tool doggy', mode: 'kebab' },
  });
  assert.match(assertGoodEmbed(transformed, '/text transform').fields[0].value, /m5rcels-tool-doggy/);

  const counted = await run({ commandName: 'text', subcommand: 'count', options: { text: 'one two three' } });
  const embed = assertGoodEmbed(counted, '/text count');
  assert.equal(embed.fields.find((field) => field.name === 'Words').value, '`3`');
});

test('/luau limits answers even when the sandbox is unreachable', async () => {
  const interaction = await run({ commandName: 'luau', subcommand: 'limits' });
  const embed = assertGoodEmbed(interaction, '/luau limits');
  assert.match(embed.title, /Luau sandbox/);
  assert.ok(embed.fields.some((field) => field.name === 'Time'));
  assert.ok(embed.fields.some((field) => field.name === 'Network' && field.value === 'None'));
  assert.equal(interaction.result().ephemeral, true);
});

test('/luau run with no code opens the multi-line editor instead', async () => {
  const interaction = createMockInteraction({ commandName: 'luau', subcommand: 'run' });
  await commands.get('luau').execute(interaction, { commands, rateLimiters: rateLimiters() });
  assert.equal(interaction.modals.length, 1, 'a modal is shown');
  const modal = interaction.modals[0].toJSON();
  assert.equal(modal.custom_id, 'modal:luau:run');
  assert.equal(modal.components[0].components[0].custom_id, 'source');
});

test('/luau reports the sandbox being down without crashing', async () => {
  // The worker is not running during unit tests, so this exercises the
  // unreachable path end to end.
  const interaction = await run({ commandName: 'luau', subcommand: 'run', options: { code: 'print(1)' } });
  const embed = assertGoodEmbed(interaction, '/luau run offline');
  assert.match(JSON.stringify(embed), /sandbox|went wrong|unavailable/i);
});

test('/wiki search, article and random render properly', async (t) => {
  let interaction;
  try {
    interaction = await run({ commandName: 'wiki', subcommand: 'search', options: { query: 'Linux', results: 3 } });
  } catch {
    return t.skip('Wikimedia API unreachable');
  }
  const embed = assertGoodEmbed(interaction, '/wiki search');
  if (/❌/.test(embed.title || '')) return t.skip('Wikimedia API unreachable');

  assert.match(embed.description, /Linux/);
  assert.ok(embed.fields.length >= 1 && embed.fields.length <= 3);
  assert.match(embed.fields[0].value, /https:\/\/en\.wikipedia\.org\/wiki\//);

  const article = await run({ commandName: 'wiki', subcommand: 'article', options: { title: 'Linux' } });
  const articleEmbed = assertGoodEmbed(article, '/wiki article');
  assert.equal(articleEmbed.url, 'https://en.wikipedia.org/wiki/Linux');
  assert.ok(articleEmbed.description.length > 100);

  const random = await run({ commandName: 'wiki', subcommand: 'random' });
  assert.match(assertGoodEmbed(random, '/wiki random').url, /wikipedia\.org\/wiki\//);

  const missing = await run({ commandName: 'wiki', subcommand: 'article', options: { title: 'ZzzQqqNotReal12345' } });
  assert.match(assertGoodEmbed(missing, '/wiki missing').title, /⚠️|❌/);
});

test('the interaction router dispatches, rate limits and never throws', async () => {
  const registry = new RateLimiterRegistry();
  registry.register('default', { uses: 1, windowMs: 60000 });
  const handle = createInteractionHandler({ commands, rateLimiters: registry });

  const asChatInput = (interaction) => Object.assign(interaction, {
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    isModalSubmit: () => false,
    isButton: () => false,
    isAnySelectMenu: () => false,
  });

  const first = asChatInput(createMockInteraction({ commandName: 'uuid' }));
  await handle(first);
  assert.ok(first.embeds()[0].fields, 'the first call goes through');

  const second = asChatInput(createMockInteraction({ commandName: 'uuid' }));
  await handle(second);
  assert.match(second.embeds()[0].title, /Slow down/, 'the second is rate limited');

  // An unknown command must produce an error embed, not an exception.
  const unknown = asChatInput(createMockInteraction({ commandName: 'does-not-exist' }));
  await handle(unknown);
  assert.match(unknown.embeds()[0].title, /❌/);

  // Anything unrecognised is silently ignored.
  await handle({
    isChatInputCommand: () => false,
    isAutocomplete: () => false,
    isModalSubmit: () => false,
    isButton: () => false,
    isAnySelectMenu: () => false,
  });
});

test('a command that throws is reported without leaking the stack', async () => {
  const broken = new Map(commands);
  broken.set('boom', {
    data: { name: 'boom' },
    category: 'utilities',
    execute: async () => { throw new Error('internal detail /Users/secret/path.js:42'); },
  });

  const handle = createInteractionHandler({ commands: broken, rateLimiters: rateLimiters() });
  const interaction = Object.assign(createMockInteraction({ commandName: 'boom' }), {
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    isModalSubmit: () => false,
    isButton: () => false,
    isAnySelectMenu: () => false,
  });

  await handle(interaction);
  const embed = interaction.embeds()[0];
  assert.match(embed.title, /Something went wrong/);
  assert.doesNotMatch(JSON.stringify(embed), /internal detail|\/Users\/secret/);
});
