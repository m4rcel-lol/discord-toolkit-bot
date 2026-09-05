'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const json = require('../src/services/json');
const { ValidationError } = require('../src/utils/validation');

test('formats and sorts keys', () => {
  const result = json.format('{"b":1,"a":2}', { indent: 2, sortKeys: true });
  assert.equal(result.output, '{\n  "a": 2,\n  "b": 1\n}');
  assert.equal(json.format('{"a":1}', { indent: 0 }).output, '{"a":1}');
  assert.equal(json.format('{"a":1}', { indent: 4 }).output, '{\n    "a": 1\n}');
});

test('minify reports the saving', () => {
  const result = json.minify('{ "a" : 1 , "b" : [ 1 , 2 ] }');
  assert.equal(result.output, '{"a":1,"b":[1,2]}');
  assert.ok(result.savedBytes > 0);
  assert.ok(result.savedPercent > 0 && result.savedPercent <= 100);
});

test('validate pinpoints the failure', () => {
  assert.equal(json.validate('{"a":1}').valid, true);
  assert.equal(json.validate('[]').valid, true);
  assert.equal(json.validate('null').valid, true);

  const bad = json.validate('{\n  "a": 1,\n}');
  assert.equal(bad.valid, false);
  assert.match(bad.message, /line 3/);
});

test('inspect describes the structure', () => {
  const info = json.inspect({ a: [1, 2, { b: true }], c: null });
  assert.equal(info.rootType, 'object');
  assert.equal(info.keys, 2);
  assert.equal(info.depth, 4);
  assert.equal(info.counts.booleans, 1);
  assert.equal(info.counts.nulls, 1);
  assert.equal(json.inspect([1, 2, 3]).length, 3);
});

test('diff finds additions, removals and changes', () => {
  const result = json.diff('{"a":1,"b":{"c":2},"d":[1,2]}', '{"a":2,"b":{},"d":[1,2,3],"e":true}');
  assert.equal(result.identical, false);
  assert.deepEqual(result.summary, { added: 2, removed: 1, changed: 1 });

  const paths = result.changes.map((change) => `${change.op}:${change.path}`).sort();
  assert.deepEqual(paths, ['added:d[2]', 'added:e', 'changed:a', 'removed:b.c']);
});

test('identical documents report as identical regardless of key order', () => {
  assert.equal(json.diff('{"a":1,"b":2}', '{"b":2,"a":1}').identical, true);
  assert.equal(json.diff('[1,2,3]', '[1,2,3]').identical, true);
  assert.equal(json.diff('{"a":[{"b":1}]}', '{"a":[{"b":1}]}').identical, true);
});

test('array length changes are reported per index', () => {
  const shorter = json.diff('[1,2,3]', '[1,2]');
  assert.deepEqual(shorter.changes, [{ op: 'removed', path: '[2]', from: 3 }]);
});

test('rejects invalid or oversized input', () => {
  assert.throws(() => json.format('not json'), ValidationError);
  assert.throws(() => json.format(''), ValidationError);
  assert.throws(() => json.diff('{}', 'nope'), ValidationError);
  assert.throws(() => json.format('"'.repeat(json.MAX_INPUT + 10)), ValidationError);
});

test('preview truncates long values', () => {
  assert.equal(json.preview({ a: 1 }), '{"a":1}');
  assert.equal(json.preview(undefined), '—');
  assert.ok(json.preview('x'.repeat(500), 20).length <= 20);
});
