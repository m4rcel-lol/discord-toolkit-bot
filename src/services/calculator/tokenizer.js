'use strict';

const { ValidationError } = require('../../utils/validation');

/**
 * Hand written tokenizer for the calculator.
 *
 * There is deliberately no `eval`, `new Function`, `vm` or any other way of
 * running user text as code anywhere in this service: the input is turned into
 * tokens, then into an AST, then walked by `evaluator.js`.
 */

const PUNCTUATION = {
  '(': 'lparen',
  ')': 'rparen',
  ',': 'comma',
};

const OPERATORS = ['**', '//', '+', '-', '*', '×', '·', '/', '÷', '^', '%', '!'];

const IDENT_START = /[A-Za-z_°πτµμ]/;
const IDENT_PART = /[A-Za-z0-9_°πτµμ]/;

/**
 * @param {string} input
 * @returns {Array<{type: string, value: any, pos: number}>}
 */
function tokenize(input) {
  const text = String(input);
  const tokens = [];
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    if (PUNCTUATION[char]) {
      tokens.push({ type: PUNCTUATION[char], value: char, pos: i });
      i += 1;
      continue;
    }

    // Numbers: 12, 1_000, .5, 1e-3, 0xFF, 0b1010, 0o17
    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(text[i + 1] || ''))) {
      const start = i;
      let value;

      const prefix = text.slice(i, i + 2).toLowerCase();
      if (char === '0' && (prefix === '0x' || prefix === '0b' || prefix === '0o')) {
        const radix = prefix === '0x' ? 16 : prefix === '0b' ? 2 : 8;
        const digits = radix === 16 ? /[0-9a-fA-F_]/ : radix === 2 ? /[01_]/ : /[0-7_]/;
        i += 2;
        let raw = '';
        while (i < text.length && digits.test(text[i])) {
          if (text[i] !== '_') raw += text[i];
          i += 1;
        }
        if (!raw) throw new ValidationError(`Incomplete number literal at position ${start + 1}.`);
        value = Number.parseInt(raw, radix);
      } else {
        let raw = '';
        let seenDot = false;
        let seenExp = false;
        while (i < text.length) {
          const c = text[i];
          if (c === '_') { i += 1; continue; }
          if (/[0-9]/.test(c)) { raw += c; i += 1; continue; }
          if (c === '.' && !seenDot && !seenExp) { seenDot = true; raw += c; i += 1; continue; }
          if ((c === 'e' || c === 'E') && !seenExp && /[0-9]/.test(raw.slice(-1))) {
            const next = text[i + 1];
            const afterSign = text[i + 2];
            if (/[0-9]/.test(next || '') || ((next === '+' || next === '-') && /[0-9]/.test(afterSign || ''))) {
              seenExp = true;
              raw += 'e';
              i += 1;
              if (text[i] === '+' || text[i] === '-') { raw += text[i]; i += 1; }
              continue;
            }
          }
          break;
        }
        value = Number.parseFloat(raw);
      }

      if (!Number.isFinite(value)) throw new ValidationError(`\`${text.slice(start, i)}\` is not a number the doggy understands.`);
      tokens.push({ type: 'number', value, pos: start });
      continue;
    }

    if (IDENT_START.test(char)) {
      const start = i;
      let raw = '';
      while (i < text.length && IDENT_PART.test(text[i])) {
        raw += text[i];
        i += 1;
      }
      tokens.push({ type: 'identifier', value: raw, pos: start });
      continue;
    }

    const operator = OPERATORS.find((op) => text.startsWith(op, i));
    if (operator) {
      // Normalise the pretty unicode operators onto their ASCII equivalents.
      const normalised = { '×': '*', '·': '*', '÷': '/' }[operator] || operator;
      tokens.push({ type: 'operator', value: normalised, pos: i });
      i += operator.length;
      continue;
    }

    throw new ValidationError(`Unexpected character \`${char}\` at position ${i + 1}.`, {
      hint: 'Supported symbols are `+ - * / % ^ ! ( ) ,` and function names.',
    });
  }

  tokens.push({ type: 'eof', value: null, pos: text.length });
  return tokens;
}

module.exports = { tokenize };
