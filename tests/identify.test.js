'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * The gateway identification block is a hard requirement of this project, so
 * it gets its own test: the exact snippet must be present, it must run before
 * the Client is constructed, and it must reach the very same `@discordjs/ws`
 * module instance that discord.js itself uses.
 */

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

const REQUIRED_SNIPPET = `const {
    DefaultWebSocketManagerOptions: {
        identifyProperties
    }
} = require("@discordjs/ws");

identifyProperties.browser = "Discord Android"; // or "Discord iOS"`;

test('the required identify snippet is present verbatim', () => {
  assert.ok(INDEX.includes(REQUIRED_SNIPPET), 'src/index.js must contain the identify snippet unchanged');
});

test('identification runs before the client is created and before login', () => {
  const identifyIndex = INDEX.indexOf('identifyProperties.browser = "Discord Android"');
  const clientIndex = INDEX.indexOf('new Client(');
  const loginIndex = INDEX.indexOf('client.login(');

  assert.ok(identifyIndex > -1 && clientIndex > -1 && loginIndex > -1);
  assert.ok(identifyIndex < clientIndex, 'identifyProperties must be set before `new Client`');
  assert.ok(identifyIndex < loginIndex, 'identifyProperties must be set before login');
});

test('only Android or iOS are accepted, whatever the environment says', () => {
  const { loadDotEnv } = require('../src/config');
  assert.equal(typeof loadDotEnv, 'function');

  // config.js clamps the value; anything else falls back to Android.
  const configSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'config.js'), 'utf8');
  assert.match(configSource, /\['Discord Android', 'Discord iOS'\]/);
});

test('the mutation reaches the module instance discord.js resolves', () => {
  const { DefaultWebSocketManagerOptions } = require('@discordjs/ws');
  DefaultWebSocketManagerOptions.identifyProperties.browser = 'Discord Android';

  const fromDiscordJs = require(
    require.resolve('@discordjs/ws', { paths: [path.dirname(require.resolve('discord.js'))] }),
  );

  assert.equal(
    fromDiscordJs.DefaultWebSocketManagerOptions.identifyProperties,
    DefaultWebSocketManagerOptions.identifyProperties,
    'both must be the same object, or the mutation would be invisible to discord.js',
  );
  assert.equal(fromDiscordJs.DefaultWebSocketManagerOptions.identifyProperties.browser, 'Discord Android');
});

test('discord.js is pinned to exactly 14.13.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies['discord.js'], '14.13.0', 'discord.js must be pinned to 14.13.0');
  assert.equal(require('discord.js').version, '14.13.0', 'the installed discord.js must be 14.13.0');

  for (const [name, range] of Object.entries(pkg.dependencies)) {
    assert.match(range, /^\d+\.\d+\.\d+$/, `${name} should be pinned to an exact version, got ${range}`);
  }
});
