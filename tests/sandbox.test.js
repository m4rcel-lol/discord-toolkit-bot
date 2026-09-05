'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { SandboxQueue } = require('../src/sandbox/queue');
const { ExecutionQueue } = require('../worker/src/queue');
const executor = require('../worker/src/executor');
const { PRELUDE_LINE, PRELUDE_LINE_COUNT } = require('../worker/src/prelude');
const luau = require('../src/services/luau');
const { ValidationError } = require('../src/utils/validation');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('the bot-side queue never exceeds its concurrency limit', async () => {
  const queue = new SandboxQueue({ maxConcurrent: 2, maxQueueDepth: 32, queueTimeoutMs: 5000 });
  let running = 0;
  let peak = 0;

  const task = async () => {
    running += 1;
    peak = Math.max(peak, running);
    await delay(20);
    running -= 1;
    return 'ok';
  };

  const results = await Promise.all(Array.from({ length: 10 }, () => queue.submit(task)));
  assert.equal(results.length, 10);
  assert.ok(results.every((value) => value === 'ok'));
  assert.equal(peak, 2, `expected at most 2 concurrent tasks, saw ${peak}`);
  assert.equal(queue.active, 0);
});

test('the queue rejects rather than growing without bound', async () => {
  const queue = new SandboxQueue({ maxConcurrent: 1, maxQueueDepth: 2, queueTimeoutMs: 5000 });
  const blocked = () => delay(200);

  const accepted = [queue.submit(blocked), queue.submit(blocked), queue.submit(blocked)];
  await assert.rejects(() => queue.submit(blocked), (error) => error.code === 'QUEUE_FULL');
  await Promise.all(accepted);
});

test('a job that waits too long is dropped before it starts', async () => {
  const queue = new SandboxQueue({ maxConcurrent: 1, maxQueueDepth: 8, queueTimeoutMs: 40 });
  let started = 0;
  const slow = async () => { started += 1; await delay(200); };

  const first = queue.submit(slow);
  await assert.rejects(() => queue.submit(slow), (error) => error.code === 'QUEUE_TIMEOUT');
  await first;
  assert.equal(started, 1, 'the timed-out job must never run');
});

test('shutdown drains everything still waiting', async () => {
  const queue = new SandboxQueue({ maxConcurrent: 1, maxQueueDepth: 8, queueTimeoutMs: 5000 });
  const first = queue.submit(() => delay(50));
  const second = queue.submit(() => delay(50));
  queue.shutdown();
  await assert.rejects(() => second, (error) => error.code === 'SHUTTING_DOWN');
  await first;
});

test('the worker queue enforces the same guarantees', async () => {
  const queue = new ExecutionQueue({ maxConcurrent: 2, maxQueueDepth: 3, queueTimeoutMs: 5000 });
  let peak = 0;
  let running = 0;
  const task = async () => {
    running += 1;
    peak = Math.max(peak, running);
    await delay(20);
    running -= 1;
  };
  const inflight = Array.from({ length: 5 }, () => queue.push(task));
  await assert.rejects(() => queue.push(task), (error) => error.code === 'QUEUE_FULL');
  await Promise.all(inflight);
  assert.equal(peak, 2);
  assert.equal(queue.snapshot().completed, 5);
});

test('source preparation strips fences and enforces the size limit', () => {
  assert.equal(luau.prepareSource('```lua\nprint(1)\n```'), 'print(1)');
  assert.equal(luau.prepareSource('```luau\nprint(1)\n```'), 'print(1)');
  assert.equal(luau.prepareSource('print(1)\r\nprint(2)'), 'print(1)\nprint(2)');
  assert.throws(() => luau.prepareSource(''), ValidationError);
  assert.throws(() => luau.prepareSource('   \n  '), ValidationError);
  assert.throws(() => luau.prepareSource('x'.repeat(1000000)), ValidationError);
});

test('the prelude stays on exactly one line so error lines stay accurate', () => {
  assert.equal(PRELUDE_LINE.includes('\n'), false, 'the prelude must be a single line');
  assert.equal(PRELUDE_LINE_COUNT, 1);
  // It must shadow with non-nil values: assigning nil re-exposes the readonly
  // parent global in Luau's sandboxed thread.
  assert.doesNotMatch(PRELUDE_LINE, /\brequire\s*=\s*nil/);
  assert.doesNotMatch(PRELUDE_LINE, /\bloadstring\s*=\s*nil/);
  assert.match(PRELUDE_LINE, /require = blocked/);
  assert.match(PRELUDE_LINE, /^do pcall\(/, 'a Luau build that rejects the prelude must not break user code');
});

test('analyser diagnostics are parsed into structured form', () => {
  const syntax = executor.parseDiagnostic("./main.luau:2:10-10: (W0) SyntaxError: Expected identifier when parsing expression, got ')'", 0);
  assert.deepEqual(syntax, {
    line: 2,
    column: 10,
    category: 'SyntaxError',
    message: "Expected identifier when parsing expression, got ')'",
  });

  const typeError = executor.parseDiagnostic("./main.luau:5:11-30: (W0) TypeError: Unknown global 'foo'", 0);
  assert.equal(typeError.category, 'TypeError');
  assert.equal(typeError.line, 5);

  // The older parenthesised form is still understood.
  assert.equal(executor.parseDiagnostic('main.luau(7,3): SyntaxError: nope', 0).line, 7);
  assert.equal(executor.parseDiagnostic('not a diagnostic', 0), null);
});

test('runtime errors map back to the user’s own line numbers', () => {
  const runtime = executor.parseRuntimeError(
    'main.luau:5: attempt to perform arithmetic (add) on nil and number\nstacktrace:\nmain.luau:5',
    PRELUDE_LINE_COUNT,
  );
  assert.equal(runtime.line, 4, 'the one-line prelude offset is removed');
  assert.equal(runtime.category, 'RuntimeError');
  assert.equal(runtime.message, 'attempt to perform arithmetic (add) on nil and number');

  const syntax = executor.parseRuntimeError("main.luau:2: Expected identifier when parsing expression, got ')'\nstacktrace:", 1);
  assert.equal(syntax.category, 'SyntaxError');
  assert.equal(syntax.line, 1);

  assert.equal(executor.parseRuntimeError('', 1), null);
});

test('the bot process contains no code path that executes Luau itself', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

  for (const file of walk(path.join(__dirname, '..', 'src'))) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /child_process/, `${file} must not spawn processes`);
    assert.doesNotMatch(source, /\beval\s*\(/, `${file} must not call eval`);
    assert.doesNotMatch(source, /new\s+Function\s*\(/, `${file} must not build a Function`);
  }
});
