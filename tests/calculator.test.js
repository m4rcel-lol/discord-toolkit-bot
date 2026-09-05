'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { calculate, formatNumber } = require('../src/services/calculator');
const { ValidationError } = require('../src/utils/validation');

/** Asserts the formatted result, ignoring the digit-grouping spaces. */
const value = (expression) => calculate(expression).value;

test('arithmetic and precedence', () => {
  assert.equal(value('5 * (20 + 3)'), 115);
  assert.equal(value('2 + 3 * 4'), 14);
  assert.equal(value('(2 + 3) * 4'), 20);
  assert.equal(value('10 - 4 - 3'), 3);
  assert.equal(value('100 / 4 / 5'), 5);
  assert.equal(value('7 // 2'), 3);
});

test('powers are right associative and unary minus binds loosely', () => {
  assert.equal(value('2^32'), 4294967296);
  assert.equal(value('2^3^2'), 512);
  assert.equal(value('2^-3'), 0.125);
  assert.equal(value('-2^2'), -4);
  assert.equal(value('2**10'), 1024);
});

test('functions, constants and implicit multiplication', () => {
  assert.equal(value('sqrt(144)'), 12);
  assert.equal(value('log(1000)'), 3);
  assert.equal(value('log2(1024)'), 10);
  assert.equal(value('log(8, 2)'), 3);
  assert.equal(value('max(1, 9, 4)'), 9);
  assert.equal(value('gcd(12, 18)'), 6);
  assert.equal(value('lcm(4, 6)'), 12);
  assert.equal(value('round(pi, 4)'), 3.1416);
  assert.equal(value('abs(-7)'), 7);
  assert.equal(Math.round(value('2pi') * 1000) / 1000, 6.283);
  assert.equal(value('2(3+4)'), 14);
  assert.equal(Math.round(value('sind(90)')), 1);
  assert.equal(Math.round(value('deg(pi)')), 180);
});

test('factorial and percent', () => {
  assert.equal(value('5!'), 120);
  assert.equal(value('0!'), 1);
  assert.equal(value('50%'), 0.5);
  assert.equal(value('50% of 200'), 100);
  assert.equal(value('10 % 3'), 1, 'percent followed by an operand is modulo');
});

test('number literals in every base', () => {
  assert.equal(value('0xFF'), 255);
  assert.equal(value('0b1010'), 10);
  assert.equal(value('0o17'), 15);
  assert.equal(value('1e3'), 1000);
  assert.equal(value('1_000_000'), 1000000);
  assert.equal(value('.5'), 0.5);
});

test('base conversion', () => {
  assert.equal(calculate('255 to binary').formatted, '11111111');
  assert.equal(calculate('255 to hex').formatted, 'FF');
  assert.equal(calculate('0xFF to decimal').formatted, '255');
  assert.equal(calculate('255 to base 36'.replace(' 36', '36')).formatted, '73');
  assert.equal(calculate('2^16 to hex').formatted, '10000');
});

test('unit conversion', () => {
  assert.equal(calculate('1 GiB to bytes').value, 1073741824);
  assert.equal(calculate('1 GB to bytes').value, 1e9);
  assert.equal(calculate('100 C to F').value, 212);
  assert.equal(calculate('32 F to C').value, 0);
  assert.equal(Math.round(calculate('10 km in miles').value * 1000) / 1000, 6.214);
  assert.equal(calculate('2 h to minutes').value, 120);
  assert.equal(calculate('1 kg to g').value, 1000);
  assert.equal(calculate('180 deg to rad').value, Math.PI);
});

test('floating point noise is cleaned up for display', () => {
  assert.equal(calculate('0.1 + 0.2').formatted, '0.3');
  assert.equal(formatNumber(1 / 3), '0.333333333333');
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(1e20), '1e+20');
});

test('invalid input raises ValidationError, never a crash', () => {
  const bad = [
    '', '   ', '1 +', '((1+2)', 'foo(2)', 'pi(', '1/0', '2 ^^ 3', 'sqrt(-1)',
    'unknownName', '5 m to kg', '255 to base99', 'x'.repeat(600), 'ln(0)', '@@@',
  ];
  for (const expression of bad) {
    assert.throws(() => calculate(expression), ValidationError, `expected ${JSON.stringify(expression)} to be rejected`);
  }
});

test('deeply nested input is rejected rather than blowing the stack', () => {
  assert.throws(() => calculate('('.repeat(200) + '1' + ')'.repeat(200)), ValidationError);
});

test('no eval-family call exists anywhere in the calculator', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '..', 'src', 'services', 'calculator');
  for (const file of fs.readdirSync(dir)) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.doesNotMatch(source, /\beval\s*\(/, `${file} must not call eval`);
    assert.doesNotMatch(source, /new\s+Function\s*\(/, `${file} must not build a Function`);
    assert.doesNotMatch(source, /require\(['"]node:vm['"]\)|require\(['"]vm['"]\)/, `${file} must not use vm`);
  }
});
