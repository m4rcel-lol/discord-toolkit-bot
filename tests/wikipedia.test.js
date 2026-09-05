'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const wikipedia = require('../src/services/wikipedia');
const { ValidationError } = require('../src/utils/validation');

/**
 * These tests talk to the real Wikimedia API, which is the point: the feature
 * is built on those endpoints and a mock would not prove they still work.
 * When there is no network they skip rather than fail the whole suite.
 */
let online = true;
test('wikipedia is reachable', async (t) => {
  try {
    await wikipedia.search('Linux', { limit: 1 });
  } catch (error) {
    online = false;
    t.skip(`Wikimedia API unreachable (${error.code || error.message}) — skipping the live tests`);
  }
});

const live = (name, fn) => test(name, async (t) => {
  if (!online) return t.skip('offline');
  return fn(t);
});

test('input is validated before any request goes out', async () => {
  await assert.rejects(() => wikipedia.search(''), ValidationError);
  await assert.rejects(() => wikipedia.search('x'.repeat(500)), ValidationError);
  await assert.rejects(() => wikipedia.article(''), ValidationError);
  await assert.rejects(() => wikipedia.search('x', { language: '../etc/passwd' }), ValidationError);
  await assert.rejects(() => wikipedia.article('x', { language: 'not a language' }), ValidationError);
});

live('search returns titles, descriptions and links', async () => {
  const result = await wikipedia.search('Linux', { limit: 3 });
  assert.equal(result.language, 'en');
  assert.ok(result.results.length > 0 && result.results.length <= 3);

  const [first] = result.results;
  assert.ok(first.title);
  assert.match(first.url, /^https:\/\/en\.wikipedia\.org\/wiki\//);
  assert.equal(typeof first.description, 'string');
  // Search excerpts arrive with HTML markup that must be stripped.
  if (first.excerpt) assert.doesNotMatch(first.excerpt, /<[^>]+>/);
});

live('search in another language edition', async () => {
  const result = await wikipedia.search('Linux', { language: 'pl', limit: 2 });
  assert.equal(result.language, 'pl');
  assert.match(result.results[0].url, /^https:\/\/pl\.wikipedia\.org\/wiki\//);
});

live('article returns a usable summary', async () => {
  const summary = await wikipedia.article('Linux');
  assert.equal(summary.title, 'Linux');
  assert.ok(summary.extract && summary.extract.length > 50);
  assert.equal(summary.url, 'https://en.wikipedia.org/wiki/Linux');
  assert.equal(summary.isDisambiguation, false);
});

live('disambiguation pages are reported, not hidden', async () => {
  const summary = await wikipedia.article('Mercury');
  assert.equal(summary.isDisambiguation, true);
  assert.equal(summary.type, 'disambiguation');
});

live('a missing article comes back with suggestions', async () => {
  await assert.rejects(
    () => wikipedia.article('ZzzzQqqNotARealArticle12345'),
    (error) => {
      assert.equal(error.code, 'NOT_FOUND');
      assert.ok(Array.isArray(error.suggestions));
      return true;
    },
  );
});

live('random returns a real article every time', async () => {
  const summary = await wikipedia.random();
  assert.ok(summary.title);
  assert.match(summary.url, /^https:\/\/en\.wikipedia\.org\/wiki\//);
});

live('title autocomplete never throws, even for nonsense', async () => {
  const titles = await wikipedia.suggestTitles('Lin');
  assert.ok(Array.isArray(titles) && titles.length > 0);
  assert.deepEqual(await wikipedia.suggestTitles('x'), [], 'a single character is too short to suggest on');
  assert.ok(Array.isArray(await wikipedia.suggestTitles('qqzzxx-nothing-here-at-all')));
});

live('repeat requests are served from the cache', async () => {
  wikipedia.cache.clear();
  await wikipedia.search('Node.js', { limit: 2 });
  const sizeAfterFirst = wikipedia.stats().cacheSize;
  assert.ok(sizeAfterFirst > 0, 'the response should be cached');

  const started = Date.now();
  await wikipedia.search('Node.js', { limit: 2 });
  assert.ok(Date.now() - started < 50, 'a cache hit should be effectively instant');
  assert.equal(wikipedia.stats().cacheSize, sizeAfterFirst, 'no extra entry for the same query');
});

test('html entities and markup are stripped from excerpts', () => {
  assert.equal(wikipedia.stripHtml('<span class="searchmatch">Linux</span> kernel'), 'Linux kernel');
  assert.equal(wikipedia.stripHtml('a &amp; b &quot;c&quot;'), 'a & b "c"');
  assert.equal(wikipedia.stripHtml('&lt;script&gt;'), '<script>');
});
