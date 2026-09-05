'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadCommands, toRegistrationPayload } = require('../src/handlers/commandLoader');
const { parseCustomId } = require('../src/handlers/interactionHandler');
const { CATEGORIES } = require('../src/utils/catalog');

const { commands, problems } = loadCommands();

test('every command file loads cleanly', () => {
  assert.deepEqual(problems, []);
  assert.ok(commands.size >= 12, `expected at least 12 commands, found ${commands.size}`);
});

test('all the documented commands exist', () => {
  const expected = ['toolkit', 'luau', 'calc', 'color', 'qr', 'wiki', 'json', 'hash', 'base64', 'timestamp', 'uuid', 'text'];
  for (const name of expected) assert.ok(commands.has(name), `/${name} should exist`);
});

test('command definitions satisfy Discord’s constraints', () => {
  for (const [name, command] of commands) {
    const json = command.data.toJSON();

    assert.match(json.name, /^[-_\p{L}\p{N}]{1,32}$/u, `${name}: invalid command name`);
    assert.equal(json.name, json.name.toLowerCase(), `${name}: names must be lower case`);
    assert.ok(json.description.length >= 1 && json.description.length <= 100, `${name}: bad description length`);
    assert.equal(typeof command.execute, 'function', `${name}: missing execute`);
    assert.ok(CATEGORIES.some((category) => category.id === command.category), `${name}: unknown category ${command.category}`);

    const checkOptions = (options, trail) => {
      for (const option of options || []) {
        assert.ok(option.description.length <= 100, `${trail}/${option.name}: description too long`);
        assert.match(option.name, /^[-_\p{L}\p{N}]{1,32}$/u, `${trail}/${option.name}: invalid option name`);
        for (const choice of option.choices || []) {
          assert.ok(choice.name.length <= 100, `${trail}/${option.name}: choice name too long`);
        }
        assert.ok((option.choices || []).length <= 25, `${trail}/${option.name}: too many choices`);
        checkOptions(option.options, `${trail}/${option.name}`);
      }
    };
    checkOptions(json.options, `/${name}`);
  }
});

test('required options come before optional ones', () => {
  const check = (options, trail) => {
    let seenOptional = false;
    for (const option of options || []) {
      // Subcommands and groups are types 1 and 2 and carry their own option lists.
      if (option.type === 1 || option.type === 2) {
        check(option.options, `${trail}/${option.name}`);
        continue;
      }
      if (option.required) {
        assert.equal(seenOptional, false, `${trail}: required option \`${option.name}\` follows an optional one`);
      } else {
        seenOptional = true;
      }
    }
  };
  for (const [name, command] of commands) check(command.data.toJSON().options, `/${name}`);
});

test('every command works in servers, DMs and group DMs', () => {
  for (const entry of toRegistrationPayload(commands)) {
    assert.deepEqual(entry.contexts, [0, 1, 2], `/${entry.name} should be usable everywhere`);
    assert.deepEqual(entry.integration_types, [0]);
    assert.equal(entry.dm_permission, undefined, 'dm_permission conflicts with contexts');
  }
});

test('user install is opt-in', () => {
  const payload = toRegistrationPayload(commands, { userInstall: true });
  assert.ok(payload.every((entry) => entry.integration_types.join() === '0,1'));
});

test('no command demands elevated permissions', () => {
  for (const [name, command] of commands) {
    const json = command.data.toJSON();
    assert.ok(
      json.default_member_permissions === undefined || json.default_member_permissions === null,
      `/${name} must not require special permissions`,
    );
  }
});

test('the whole registration payload fits well inside Discord’s limits', () => {
  const payload = toRegistrationPayload(commands);
  assert.ok(payload.length <= 100, 'at most 100 global commands');
  assert.ok(JSON.stringify(payload).length < 200000);
});

test('components and modals use routable custom ids', () => {
  assert.deepEqual(parseCustomId('cmd:toolkit:category'), { prefix: 'cmd', command: 'toolkit', action: 'category' });
  assert.deepEqual(parseCustomId('modal:luau:run'), { prefix: 'modal', command: 'luau', action: 'run' });
  assert.equal(parseCustomId('').prefix, '');

  // Any command exposing a handler must be reachable through that id scheme.
  for (const [name, command] of commands) {
    if (typeof command.handleComponent === 'function' || typeof command.handleModal === 'function') {
      assert.ok(commands.has(name), `${name} must be resolvable from its custom id`);
    }
  }
});

test('the catalog only advertises commands that exist', () => {
  for (const category of CATEGORIES) {
    for (const entry of category.commands) {
      const commandName = entry.name.replace(/^\//, '').split(' ')[0];
      assert.ok(commands.has(commandName), `the catalog lists /${commandName}, which does not exist`);
    }
  }
});
