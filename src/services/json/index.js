'use strict';

const { ValidationError } = require('../../utils/validation');

/** JSON formatting, validation and structural diffing. */

const MAX_INPUT = 200000;

/**
 * Parses JSON and turns a SyntaxError into something a human can act on.
 * @returns {{ value: unknown }}
 */
function parseJson(text, label = 'input') {
  const source = String(text ?? '');
  if (!source.trim()) throw new ValidationError(`The ${label} is empty.`);
  if (source.length > MAX_INPUT) {
    throw new ValidationError(`That ${label} is too large (${source.length} characters, maximum is ${MAX_INPUT}).`);
  }
  try {
    return { value: JSON.parse(source) };
  } catch (error) {
    throw new ValidationError(describeSyntaxError(error, source, label), { hint: 'Check quotes, commas and brackets.' });
  }
}

function describeSyntaxError(error, source, label) {
  const message = String(error.message);
  const positionMatch = /position (\d+)/i.exec(message);
  if (!positionMatch) return `The ${label} is not valid JSON: ${message}`;

  const position = Number.parseInt(positionMatch[1], 10);
  const before = source.slice(0, position);
  const line = before.split('\n').length;
  const column = position - before.lastIndexOf('\n');
  const reason = message.split(/ in JSON| at position/i)[0].trim();
  return `The ${label} is not valid JSON — line ${line}, column ${column}: ${reason}`;
}

/** Human readable structural summary used in every JSON embed. */
function inspect(value) {
  const counts = { objects: 0, arrays: 0, strings: 0, numbers: 0, booleans: 0, nulls: 0 };
  let maxDepth = 0;
  let nodes = 0;

  const walk = (node, depth) => {
    nodes += 1;
    maxDepth = Math.max(maxDepth, depth);
    if (node === null) { counts.nulls += 1; return; }
    if (Array.isArray(node)) {
      counts.arrays += 1;
      for (const item of node) walk(item, depth + 1);
      return;
    }
    switch (typeof node) {
      case 'object':
        counts.objects += 1;
        for (const item of Object.values(node)) walk(item, depth + 1);
        break;
      case 'string': counts.strings += 1; break;
      case 'number': counts.numbers += 1; break;
      case 'boolean': counts.booleans += 1; break;
      default: break;
    }
  };

  walk(value, 1);
  return {
    rootType: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value,
    depth: maxDepth,
    nodes,
    counts,
    keys: value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length : null,
    length: Array.isArray(value) ? value.length : null,
  };
}

function format(text, { indent = 2, sortKeys = false } = {}) {
  const { value } = parseJson(text);
  const spacing = Math.min(8, Math.max(0, Number(indent) || 0));
  const prepared = sortKeys ? sortDeep(value) : value;
  const output = spacing === 0 ? JSON.stringify(prepared) : JSON.stringify(prepared, null, spacing);
  return { output, value: prepared, info: inspect(prepared), originalLength: String(text).length };
}

function minify(text) {
  const { value } = parseJson(text);
  const output = JSON.stringify(value);
  const originalLength = String(text).length;
  return {
    output,
    value,
    info: inspect(value),
    originalLength,
    savedBytes: Math.max(0, originalLength - output.length),
    savedPercent: originalLength ? Math.round(((originalLength - output.length) / originalLength) * 1000) / 10 : 0,
  };
}

function validate(text) {
  try {
    const { value } = parseJson(text);
    return { valid: true, info: inspect(value), value };
  } catch (error) {
    return { valid: false, message: error.message, hint: error.hint };
  }
}

/** Recursively sorts object keys so diffs and formatting stay stable. */
function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortDeep(value[key])]),
    );
  }
  return value;
}

const MAX_DIFF_ENTRIES = 200;

/**
 * Structural diff between two JSON documents.
 * @returns {{ identical: boolean, changes: Array<{ op: string, path: string, from?: any, to?: any }> }}
 */
function diff(leftText, rightText) {
  const left = parseJson(leftText, 'first document').value;
  const right = parseJson(rightText, 'second document').value;

  const changes = [];
  let truncated = false;

  const push = (change) => {
    if (changes.length >= MAX_DIFF_ENTRIES) {
      truncated = true;
      return;
    }
    changes.push(change);
  };

  const walk = (a, b, path) => {
    if (truncated) return;
    if (deepEqual(a, b)) return;

    const aIsObject = a && typeof a === 'object';
    const bIsObject = b && typeof b === 'object';
    const sameShape = aIsObject && bIsObject && Array.isArray(a) === Array.isArray(b);

    if (!sameShape) {
      push({ op: 'changed', path, from: a, to: b });
      return;
    }

    if (Array.isArray(a)) {
      const max = Math.max(a.length, b.length);
      for (let i = 0; i < max; i += 1) {
        if (i >= a.length) push({ op: 'added', path: `${path}[${i}]`, to: b[i] });
        else if (i >= b.length) push({ op: 'removed', path: `${path}[${i}]`, from: a[i] });
        else walk(a[i], b[i], `${path}[${i}]`);
      }
      return;
    }

    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in a)) push({ op: 'added', path: childPath, to: b[key] });
      else if (!(key in b)) push({ op: 'removed', path: childPath, from: a[key] });
      else walk(a[key], b[key], childPath);
    }
  };

  walk(left, right, '');

  return {
    identical: changes.length === 0 && !truncated,
    changes,
    truncated,
    summary: {
      added: changes.filter((change) => change.op === 'added').length,
      removed: changes.filter((change) => change.op === 'removed').length,
      changed: changes.filter((change) => change.op === 'changed').length,
    },
  };
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
}

/** Short one-line rendering of a value, for diff output. */
function preview(value, max = 60) {
  if (value === undefined) return '—';
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text === undefined) text = 'undefined';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

module.exports = { parseJson, format, minify, validate, diff, inspect, preview, sortDeep, MAX_INPUT };
