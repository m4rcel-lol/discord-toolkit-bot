'use strict';

const { tokenize } = require('./tokenizer');
const { ValidationError } = require('../../utils/validation');

/**
 * Recursive descent parser producing a small AST.
 *
 * Node shapes:
 *   { type: 'number', value }
 *   { type: 'identifier', name }
 *   { type: 'call', name, args: Node[] }
 *   { type: 'unary', operator, operand }
 *   { type: 'postfix', operator, operand }   // '!' factorial, '%' percent
 *   { type: 'binary', operator, left, right }
 *
 * Precedence (loose -> tight):
 *   + -
 *   * / % // (and implicit multiplication)
 *   unary + -
 *   ^ ** (right associative)
 *   postfix ! %
 */
class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
    this.depth = 0;
  }

  peek(offset = 0) {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)];
  }

  next() {
    return this.tokens[this.index++];
  }

  expect(type, description) {
    const token = this.peek();
    if (token.type !== type) {
      throw new ValidationError(`Expected ${description} at position ${token.pos + 1}.`);
    }
    return this.next();
  }

  parse() {
    const node = this.parseExpression();
    const token = this.peek();
    if (token.type !== 'eof') {
      throw new ValidationError(`Unexpected \`${token.value}\` at position ${token.pos + 1}.`);
    }
    return node;
  }

  parseExpression() {
    // Guard against pathological nesting blowing the JS stack.
    if (this.depth > 64) throw new ValidationError('That expression is nested too deeply.');
    let left = this.parseTerm();
    while (this.peek().type === 'operator' && ['+', '-'].includes(this.peek().value)) {
      const operator = this.next().value;
      const right = this.parseTerm();
      left = { type: 'binary', operator, left, right };
    }
    return left;
  }

  parseTerm() {
    let left = this.parseUnary();
    for (;;) {
      const token = this.peek();

      if (token.type === 'operator' && ['*', '/', '//'].includes(token.value)) {
        this.next();
        left = { type: 'binary', operator: token.value, left, right: this.parseUnary() };
        continue;
      }

      // `%` is modulo when something follows it, percent when it does not.
      if (token.type === 'operator' && token.value === '%' && this.startsOperand(this.peek(1))) {
        this.next();
        left = { type: 'binary', operator: 'mod', left, right: this.parseUnary() };
        continue;
      }

      // `50% of 200` reads naturally, so `of` is just a multiplication word.
      if (token.type === 'identifier' && String(token.value).toLowerCase() === 'of') {
        this.next();
        left = { type: 'binary', operator: '*', left, right: this.parseUnary() };
        continue;
      }

      // Implicit multiplication: 2(3+4), 2pi, 3sqrt(4).
      if (token.type === 'number' || token.type === 'lparen' || token.type === 'identifier') {
        left = { type: 'binary', operator: '*', left, right: this.parseUnary(), implicit: true };
        continue;
      }

      break;
    }
    return left;
  }

  startsOperand(token) {
    // `of` is a keyword, not an operand, so `50% of 200` stays a percentage.
    if (token.type === 'identifier') return String(token.value).toLowerCase() !== 'of';
    return token.type === 'number' || token.type === 'lparen';
  }

  parseUnary() {
    const token = this.peek();
    if (token.type === 'operator' && (token.value === '-' || token.value === '+')) {
      this.next();
      return { type: 'unary', operator: token.value, operand: this.parseUnary() };
    }
    return this.parsePower();
  }

  parsePower() {
    const base = this.parsePostfix();
    const token = this.peek();
    if (token.type === 'operator' && (token.value === '^' || token.value === '**')) {
      this.next();
      // Right associative, and the exponent may be signed: 2^-3.
      return { type: 'binary', operator: '^', left: base, right: this.parseUnary() };
    }
    return base;
  }

  parsePostfix() {
    let node = this.parsePrimary();
    for (;;) {
      const token = this.peek();
      if (token.type === 'operator' && token.value === '!') {
        this.next();
        node = { type: 'postfix', operator: '!', operand: node };
        continue;
      }
      if (token.type === 'operator' && token.value === '%' && !this.startsOperand(this.peek(1))) {
        this.next();
        node = { type: 'postfix', operator: '%', operand: node };
        continue;
      }
      break;
    }
    return node;
  }

  parsePrimary() {
    const token = this.next();

    if (token.type === 'number') return { type: 'number', value: token.value };

    if (token.type === 'identifier') {
      if (this.peek().type === 'lparen') {
        this.next();
        const args = [];
        if (this.peek().type !== 'rparen') {
          this.depth += 1;
          args.push(this.parseExpression());
          while (this.peek().type === 'comma') {
            this.next();
            args.push(this.parseExpression());
          }
          this.depth -= 1;
        }
        this.expect('rparen', 'a closing `)`');
        return { type: 'call', name: token.value, args };
      }
      return { type: 'identifier', name: token.value };
    }

    if (token.type === 'lparen') {
      this.depth += 1;
      const node = this.parseExpression();
      this.depth -= 1;
      this.expect('rparen', 'a closing `)`');
      return node;
    }

    if (token.type === 'eof') {
      throw new ValidationError('The expression ended unexpectedly — is a bracket or operand missing?');
    }

    throw new ValidationError(`Unexpected \`${token.value}\` at position ${token.pos + 1}.`);
  }
}

function parse(input) {
  return new Parser(tokenize(input)).parse();
}

module.exports = { parse, Parser };
