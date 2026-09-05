'use strict';

const { parse } = require('./parser');
const { evaluate, FUNCTIONS, CONSTANTS } = require('./evaluator');
const { resolveUnit, convert, DEFINITIONS } = require('./units');
const { ValidationError } = require('../../utils/validation');
const { groupDigits } = require('../../utils/format');

/**
 * Public calculator API.
 *
 * `calculate()` understands three shapes of input:
 *   1. a plain expression                 -> `5 * (20 + 3)`
 *   2. a unit conversion                  -> `1 GiB to bytes`
 *   3. a numeral base conversion          -> `255 to binary`
 */

const BASE_TARGETS = {
  binary: 2, bin: 2, base2: 2, b2: 2,
  octal: 8, oct: 8, base8: 8,
  decimal: 10, dec: 10, base10: 10, denary: 10,
  hex: 16, hexadecimal: 16, base16: 16,
};

const BASE_LABEL = { 2: 'binary', 8: 'octal', 10: 'decimal', 16: 'hexadecimal' };

/** Finds the last top-level ` to ` / ` in ` separator, ignoring bracketed text. */
function splitConversion(input) {
  const text = String(input);
  let depth = 0;
  let best = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && /\s/.test(char)) {
      const match = /^\s+(to|in|as|into)\s+/i.exec(text.slice(i));
      if (match) best = { index: i, length: match[0].length, keyword: match[1].toLowerCase() };
    }
  }
  if (!best) return null;
  return {
    left: text.slice(0, best.index).trim(),
    right: text.slice(best.index + best.length).trim(),
  };
}

/** Pulls a trailing unit off `1.5 GiB` -> { expression: '1.5', unitKey: 'GiB' }. */
function splitTrailingUnit(text) {
  const match = /^([\s\S]*?)([A-Za-z°µμ][A-Za-z0-9°µμ^]*(?:\/[A-Za-z]+)?)\s*$/.exec(text);
  if (!match) return null;
  const [, head, candidate] = match;
  if (!head.trim()) return null; // "km" on its own is not a value
  const resolved = resolveUnit(candidate);
  if (!resolved) return null;
  return { expression: head.trim(), unitKey: resolved.key, unit: resolved.unit };
}

/** Formats a float without the usual binary-floating-point noise. */
function formatNumber(value, { group = true } = {}) {
  if (Number.isNaN(value)) return 'NaN';
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞';
  if (value === 0) return '0';

  const magnitude = Math.abs(value);
  let text;
  if (magnitude >= 1e15 || magnitude < 1e-6) {
    text = value.toExponential(8).replace(/\.?0+e/, 'e');
    return text;
  }
  if (Number.isInteger(value)) {
    text = String(value);
  } else {
    // 12 significant digits kills 0.1 + 0.2 = 0.30000000000000004 style noise.
    text = Number.parseFloat(value.toPrecision(12)).toString();
  }
  return group ? groupDigits(text) : text;
}

function toBase(value, radix) {
  if (!Number.isFinite(value)) throw new ValidationError('Only finite numbers can be converted between bases.');
  if (!Number.isInteger(value)) {
    throw new ValidationError('Base conversion needs a whole number.', { hint: 'Try `round(…)` first.' });
  }
  if (Math.abs(value) > Number.MAX_SAFE_INTEGER) {
    throw new ValidationError('That number is too large to convert exactly.');
  }
  const sign = value < 0 ? '-' : '';
  return sign + Math.abs(value).toString(radix).toUpperCase();
}

/** Nicely grouped alternative representations shown alongside integer results. */
function integerViews(value) {
  if (!Number.isInteger(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) return null;
  return {
    binary: toBase(value, 2),
    octal: toBase(value, 8),
    hexadecimal: `0x${toBase(value, 16)}`,
  };
}

/**
 * @param {string} rawInput
 * @returns {{ kind: string, input: string, value: number, formatted: string, detail?: object }}
 */
function calculate(rawInput) {
  const input = String(rawInput ?? '').trim();
  if (!input) throw new ValidationError('Give the doggy something to calculate.');
  if (input.length > 500) throw new ValidationError('That expression is too long (maximum 500 characters).');

  const split = splitConversion(input);

  if (split) {
    const targetKey = split.right.toLowerCase().replace(/\s+/g, '');
    const baseMatch = /^base(\d{1,2})$/.exec(targetKey);
    const radix = BASE_TARGETS[targetKey] ?? (baseMatch ? Number.parseInt(baseMatch[1], 10) : undefined);

    if (radix !== undefined) {
      if (radix < 2 || radix > 36) throw new ValidationError('Bases from 2 to 36 are supported.');
      const value = evaluate(parse(split.left));
      return {
        kind: 'base',
        input,
        value,
        formatted: toBase(value, radix),
        detail: {
          radix,
          radixLabel: BASE_LABEL[radix] || `base ${radix}`,
          decimal: formatNumber(value),
          views: integerViews(value),
        },
      };
    }

    const targetUnit = resolveUnit(split.right);
    if (targetUnit) {
      const source = splitTrailingUnit(split.left);
      if (!source) {
        throw new ValidationError('Add a unit to the value you want to convert.', {
          hint: 'For example `1 GiB to bytes` or `20 C to F`.',
        });
      }
      const amount = evaluate(parse(source.expression));
      let converted;
      try {
        converted = convert(amount, source.unitKey, targetUnit.key);
      } catch (error) {
        if (error.code === 'DIMENSION_MISMATCH') throw new ValidationError(error.message);
        throw error;
      }
      return {
        kind: 'conversion',
        input,
        value: converted,
        formatted: formatNumber(converted),
        detail: {
          from: { key: source.unitKey, label: source.unit.label, value: amount, formatted: formatNumber(amount) },
          to: { key: targetUnit.key, label: targetUnit.unit.label },
          dimension: targetUnit.unit.dim,
        },
      };
    }

    throw new ValidationError(`\`${split.right}\` is not a unit or number base the doggy knows.`, {
      hint: 'Try `binary`, `hex`, `bytes`, `km`, `kg`, `F`, `minutes`, …',
    });
  }

  const value = evaluate(parse(input));
  return {
    kind: 'expression',
    input,
    value,
    formatted: formatNumber(value),
    detail: { views: integerViews(value), exact: Number.isFinite(value) ? String(value) : null },
  };
}

/** Names offered by the `/calc` autocomplete. */
function suggestions() {
  return [
    ...Object.keys(FUNCTIONS).map((name) => `${name}(`),
    ...Object.keys(CONSTANTS).filter((name) => /^[a-z]+$/.test(name)),
    ...Object.keys(DEFINITIONS),
  ];
}

module.exports = { calculate, formatNumber, toBase, suggestions };
