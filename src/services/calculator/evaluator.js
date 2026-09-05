'use strict';

const { ValidationError } = require('../../utils/validation');

/** Constants available inside expressions. */
const CONSTANTS = {
  pi: Math.PI,
  'π': Math.PI,
  tau: Math.PI * 2,
  'τ': Math.PI * 2,
  e: Math.E,
  phi: (1 + Math.sqrt(5)) / 2,
  golden: (1 + Math.sqrt(5)) / 2,
  inf: Infinity,
  infinity: Infinity,
  c: 299792458,
  g: 9.80665,
};

const DEG = Math.PI / 180;

function factorial(n) {
  if (!Number.isInteger(n) || n < 0) throw new ValidationError('Factorial is only defined for non-negative whole numbers.');
  if (n > 170) return Infinity; // 171! overflows a double
  let result = 1;
  for (let i = 2; i <= n; i += 1) result *= i;
  return result;
}

function gcd(a, b) {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y) [x, y] = [y, x % y];
  return x;
}

/** name -> { arity: number | [min, max], fn } */
const FUNCTIONS = {
  sqrt: { arity: 1, fn: (x) => {
    if (x < 0) throw new ValidationError('`sqrt` of a negative number is not a real number.');
    return Math.sqrt(x);
  } },
  cbrt: { arity: 1, fn: Math.cbrt },
  abs: { arity: 1, fn: Math.abs },
  sign: { arity: 1, fn: Math.sign },
  floor: { arity: 1, fn: Math.floor },
  ceil: { arity: 1, fn: Math.ceil },
  trunc: { arity: 1, fn: Math.trunc },
  round: { arity: [1, 2], fn: (x, digits = 0) => {
    const factor = 10 ** Math.max(0, Math.min(15, Math.trunc(digits)));
    return Math.round(x * factor) / factor;
  } },
  exp: { arity: 1, fn: Math.exp },
  ln: { arity: 1, fn: (x) => {
    if (x <= 0) throw new ValidationError('`ln` needs a positive number.');
    return Math.log(x);
  } },
  log: { arity: [1, 2], fn: (x, base) => {
    if (x <= 0) throw new ValidationError('`log` needs a positive number.');
    if (base === undefined) return Math.log10(x);
    if (base <= 0 || base === 1) throw new ValidationError('`log` needs a positive base that is not 1.');
    return Math.log(x) / Math.log(base);
  } },
  log2: { arity: 1, fn: (x) => {
    if (x <= 0) throw new ValidationError('`log2` needs a positive number.');
    return Math.log2(x);
  } },
  log10: { arity: 1, fn: (x) => {
    if (x <= 0) throw new ValidationError('`log10` needs a positive number.');
    return Math.log10(x);
  } },

  sin: { arity: 1, fn: Math.sin },
  cos: { arity: 1, fn: Math.cos },
  tan: { arity: 1, fn: Math.tan },
  asin: { arity: 1, fn: (x) => {
    if (x < -1 || x > 1) throw new ValidationError('`asin` needs a value between -1 and 1.');
    return Math.asin(x);
  } },
  acos: { arity: 1, fn: (x) => {
    if (x < -1 || x > 1) throw new ValidationError('`acos` needs a value between -1 and 1.');
    return Math.acos(x);
  } },
  atan: { arity: 1, fn: Math.atan },
  atan2: { arity: 2, fn: Math.atan2 },
  sinh: { arity: 1, fn: Math.sinh },
  cosh: { arity: 1, fn: Math.cosh },
  tanh: { arity: 1, fn: Math.tanh },

  // Degree-flavoured trigonometry, because people ask for it constantly.
  sind: { arity: 1, fn: (x) => Math.sin(x * DEG) },
  cosd: { arity: 1, fn: (x) => Math.cos(x * DEG) },
  tand: { arity: 1, fn: (x) => Math.tan(x * DEG) },
  deg: { arity: 1, fn: (x) => x / DEG },
  rad: { arity: 1, fn: (x) => x * DEG },

  min: { arity: [1, 16], fn: (...args) => Math.min(...args) },
  max: { arity: [1, 16], fn: (...args) => Math.max(...args) },
  sum: { arity: [1, 32], fn: (...args) => args.reduce((a, b) => a + b, 0) },
  avg: { arity: [1, 32], fn: (...args) => args.reduce((a, b) => a + b, 0) / args.length },
  hypot: { arity: [2, 8], fn: (...args) => Math.hypot(...args) },
  pow: { arity: 2, fn: (a, b) => a ** b },
  mod: { arity: 2, fn: (a, b) => {
    if (b === 0) throw new ValidationError('Cannot take a modulo of zero.');
    return a % b;
  } },
  gcd: { arity: [2, 8], fn: (...args) => args.reduce((a, b) => gcd(a, b)) },
  lcm: { arity: [2, 8], fn: (...args) => args.reduce((a, b) => {
    const divisor = gcd(a, b);
    return divisor === 0 ? 0 : Math.abs(Math.trunc(a) * Math.trunc(b)) / divisor;
  }) },
  fact: { arity: 1, fn: factorial },
  factorial: { arity: 1, fn: factorial },
};

function checkArity(name, arity, count) {
  const [min, max] = Array.isArray(arity) ? arity : [arity, arity];
  if (count < min || count > max) {
    const expected = min === max ? `${min}` : `${min}–${max}`;
    throw new ValidationError(`\`${name}\` expects ${expected} argument${max === 1 ? '' : 's'}, got ${count}.`);
  }
}

/**
 * Walks the AST produced by `parser.js`.
 * @param {object} node
 * @returns {number}
 */
function evaluate(node) {
  switch (node.type) {
    case 'number':
      return node.value;

    case 'identifier': {
      const key = node.name.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(CONSTANTS, node.name)) return CONSTANTS[node.name];
      if (Object.prototype.hasOwnProperty.call(CONSTANTS, key)) return CONSTANTS[key];
      if (Object.prototype.hasOwnProperty.call(FUNCTIONS, key)) {
        throw new ValidationError(`\`${node.name}\` is a function — call it like \`${key}(…)\`.`);
      }
      throw new ValidationError(`Unknown name \`${node.name}\`.`, {
        hint: 'Try a constant like `pi`, `e`, `tau`, or a function like `sqrt(…)`.',
      });
    }

    case 'call': {
      const key = node.name.toLowerCase();
      const definition = FUNCTIONS[key];
      if (!definition) throw new ValidationError(`Unknown function \`${node.name}\`.`);
      const args = node.args.map(evaluate);
      checkArity(key, definition.arity, args.length);
      return definition.fn(...args);
    }

    case 'unary': {
      const value = evaluate(node.operand);
      return node.operator === '-' ? -value : value;
    }

    case 'postfix': {
      const value = evaluate(node.operand);
      if (node.operator === '!') return factorial(value);
      return value / 100; // percent
    }

    case 'binary': {
      const left = evaluate(node.left);
      const right = evaluate(node.right);
      switch (node.operator) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/':
          if (right === 0) throw new ValidationError('Division by zero.');
          return left / right;
        case '//':
          if (right === 0) throw new ValidationError('Division by zero.');
          return Math.floor(left / right);
        case 'mod':
          if (right === 0) throw new ValidationError('Cannot take a modulo of zero.');
          return left % right;
        case '^': {
          const result = left ** right;
          if (Number.isNaN(result) && !Number.isNaN(left) && !Number.isNaN(right)) {
            throw new ValidationError('That power is not defined for real numbers.');
          }
          return result;
        }
        default:
          throw new ValidationError(`Unsupported operator \`${node.operator}\`.`);
      }
    }

    default:
      throw new ValidationError('That expression could not be evaluated.');
  }
}

module.exports = { evaluate, FUNCTIONS, CONSTANTS };
