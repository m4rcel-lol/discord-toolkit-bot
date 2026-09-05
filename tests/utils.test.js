'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { RateLimiter, RateLimiterRegistry } = require('../src/utils/rateLimit');
const { TtlCache } = require('../src/utils/cache');
const validation = require('../src/utils/validation');
const embeds = require('../src/utils/embeds');
const format = require('../src/utils/format');
const text = require('../src/services/text');

test('rate limiter allows the configured burst then blocks', () => {
  const limiter = new RateLimiter({ uses: 3, windowMs: 1000 });
  assert.equal(limiter.consume('u').allowed, true);
  assert.equal(limiter.consume('u').allowed, true);
  const third = limiter.consume('u');
  assert.equal(third.allowed, true);
  assert.equal(third.remaining, 0);

  const blocked = limiter.consume('u');
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0 && blocked.retryAfterMs <= 1000);

  // Buckets are per key.
  assert.equal(limiter.consume('other').allowed, true);
});

test('rate limiter refunds and expires', async () => {
  const limiter = new RateLimiter({ uses: 1, windowMs: 60 });
  assert.equal(limiter.consume('u').allowed, true);
  assert.equal(limiter.consume('u').allowed, false);

  limiter.refund('u');
  assert.equal(limiter.consume('u').allowed, true);

  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(limiter.consume('u').allowed, true, 'the window should have slid past');
});

test('rate limiter sweeps its map so it cannot leak', async () => {
  const limiter = new RateLimiter({ uses: 1, windowMs: 30 });
  for (let i = 0; i < 200; i += 1) limiter.consume(`user-${i}`);
  assert.equal(limiter.hits.size, 200);
  await new Promise((resolve) => setTimeout(resolve, 50));
  limiter.consume('trigger-sweep');
  assert.ok(limiter.hits.size <= 2, `expected the sweep to clear old buckets, got ${limiter.hits.size}`);
});

test('registry falls back to the default bucket', () => {
  const registry = new RateLimiterRegistry();
  registry.register('default', { uses: 1, windowMs: 1000 });
  assert.equal(registry.consume('nonexistent', 'u').allowed, true);
  assert.equal(registry.consume('nonexistent', 'u').allowed, false, 'unknown buckets share the default');
});

test('ttl cache expires, evicts and never caches failures', async () => {
  const cache = new TtlCache({ ttlMs: 40, max: 3 });
  cache.set('a', 1);
  assert.equal(cache.get('a'), 1);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(cache.get('a'), undefined);

  for (const key of ['a', 'b', 'c', 'd']) cache.set(key, key, 10000);
  assert.equal(cache.size, 3);
  assert.equal(cache.get('a'), undefined, 'the oldest entry is evicted');

  await assert.rejects(cache.wrap('boom', async () => { throw new Error('nope'); }));
  assert.equal(cache.get('boom'), undefined);

  let calls = 0;
  const producer = async () => { calls += 1; return 'value'; };
  const [x, y] = await Promise.all([cache.wrap('k', producer), cache.wrap('k', producer)]);
  assert.equal(x, 'value');
  assert.equal(y, 'value');
  assert.equal(calls, 1, 'concurrent misses share one in-flight promise');
});

test('validation helpers', () => {
  assert.equal(validation.stripCodeFence('```lua\nprint(1)\n```'), 'print(1)');
  assert.equal(validation.stripCodeFence('```\nplain\n```'), 'plain');
  assert.equal(validation.stripCodeFence('`inline`'), 'inline');
  assert.equal(validation.stripCodeFence('untouched'), 'untouched');
  assert.equal(validation.expandEscapes('a\\nb'), 'a\nb');

  assert.equal(validation.requireLanguage('PL'), 'pl');
  assert.equal(validation.requireLanguage(''), 'en');
  assert.throws(() => validation.requireLanguage('../etc'), validation.ValidationError);
  assert.throws(() => validation.requireLanguage('toolongcode'), validation.ValidationError);

  assert.throws(() => validation.requireHttpUrl('javascript:alert(1)'), validation.ValidationError);
  assert.throws(() => validation.requireHttpUrl('file:///etc/passwd'), validation.ValidationError);
  assert.ok(validation.requireHttpUrl('https://example.com'));

  for (const bad of ['http://localhost/x', 'http://127.0.0.1/x', 'http://10.0.0.1/x', 'http://192.168.1.1/x', 'http://172.16.0.1/x', 'http://169.254.169.254/latest']) {
    assert.throws(() => validation.assertPublicUrl(bad), validation.ValidationError, `${bad} should be blocked`);
  }
  assert.ok(validation.assertPublicUrl('https://cdn.discordapp.com/x.png'));

  assert.throws(() => validation.requireString('', 'x'), validation.ValidationError);
  assert.throws(() => validation.requireString('abc', 'x', { max: 2 }), validation.ValidationError);
  assert.equal(validation.byteLength('é'), 2);
});

test('embeds clamp to Discord limits', () => {
  const embed = embeds.createResultEmbed({
    title: 'x'.repeat(500),
    description: 'y'.repeat(5000),
    fields: Array.from({ length: 40 }, (_, i) => ({ name: `n${i}`, value: 'v'.repeat(2000) })),
  });
  const data = embed.toJSON();
  assert.ok(data.title.length <= embeds.LIMITS.title);
  assert.ok(data.description.length <= embeds.LIMITS.description);
  assert.equal(data.fields.length, embeds.LIMITS.fields);
  for (const field of data.fields) assert.ok(field.value.length <= embeds.LIMITS.fieldValue);
  assert.ok(data.timestamp, 'every embed carries a timestamp');
  assert.match(data.footer.text, /m5rcel's tool doggy/);
});

test('code blocks always stay inside their budget and stay closed', () => {
  const block = embeds.codeBlock('x'.repeat(5000), 'json', 1024);
  assert.ok(block.length <= 1024, `expected <= 1024, got ${block.length}`);
  assert.ok(block.startsWith('```json\n') && block.endsWith('\n```'));
  assert.ok(embeds.codeBlock('', '').includes('```'));
});

test('error embeds never leak internals', () => {
  const data = embeds.createErrorEmbed({}).toJSON();
  assert.match(data.description, /couldn't complete that request/);
  assert.doesNotMatch(JSON.stringify(data), /at Object\.|node_modules|\.js:\d+/);
});

test('formatting helpers', () => {
  assert.equal(format.humanBytes(0), '0 B');
  assert.equal(format.humanBytes(1024), '1 KiB');
  assert.equal(format.humanBytes(1536), '1.5 KiB');
  assert.equal(format.humanDuration(12), '12 ms');
  assert.equal(format.humanDuration(1500), '1.50 s');
  assert.equal(format.humanDuration(90000), '1m 30s');
  // Digit groups are separated by U+2009 THIN SPACE, spelled out here so the
  // expectation cannot silently drift to an ordinary space.
  assert.equal(format.groupDigits('4294967296'), '4\u2009294\u2009967\u2009296');
  assert.equal(format.groupDigits('1234'), '1234', 'four digits stay ungrouped');
  assert.equal(format.groupDigits('-1234567'), '-1\u2009234\u2009567');
  assert.match(format.groupDigits('4294967296'), /^[\d\s]+$/, 'the separator matches \\s so it round trips through /calc');
});

test('text transforms', () => {
  assert.equal(text.transform('hello world', 'camel').output, 'helloWorld');
  assert.equal(text.transform('hello world', 'pascal').output, 'HelloWorld');
  assert.equal(text.transform('helloWorld', 'snake').output, 'hello_world');
  assert.equal(text.transform('Hello World', 'kebab').output, 'hello-world');
  assert.equal(text.transform('Hello World', 'constant').output, 'HELLO_WORLD');
  assert.equal(text.transform('Héllo Wörld!', 'slug').output, 'hello-world');
  assert.equal(text.transform('abc', 'reverse').output, 'cba');
  assert.throws(() => text.transform('abc', 'nope'), validation.ValidationError);
  assert.throws(() => text.transform('', 'upper'), validation.ValidationError);

  const stats = text.count('Hello world.\nSecond line!');
  assert.equal(stats.words, 4);
  assert.equal(stats.lines, 2);
  assert.equal(stats.sentences, 2);
});
