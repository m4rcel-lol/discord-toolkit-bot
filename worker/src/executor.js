'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { limits } = require('./limits');
const { PRELUDE_LINE, PRELUDE_LINE_COUNT } = require('./prelude');

/**
 * Runs a single Luau program in a disposable working directory.
 *
 * Isolation layers, from outermost to innermost:
 *   1. The container itself: non-root user, read-only root filesystem, all
 *      Linux capabilities dropped, `no-new-privileges`, an internal-only
 *      network with no route to the internet, a pids limit, and a memory limit
 *      (see docker-compose.yml). It holds no Discord token and no secrets
 *      other than the shared worker token used to authenticate the bot.
 *   2. Per-process rlimits applied here through `sh -c 'ulimit …; exec …'`:
 *      address space, CPU seconds, file size, open files and core dumps.
 *   3. A wall-clock timeout enforced by this process (SIGKILL, no mercy).
 *   4. An output-size cap that kills the process the moment it is exceeded.
 *   5. A one-line Lua prelude that removes `io`, `require`, `load*` and the
 *      dangerous half of `os` from the global environment.
 *
 * The working directory is created fresh per job and removed afterwards, so
 * nothing survives between executions.
 */

const LUAU_BIN = process.env.LUAU_BIN || 'luau';
const LUAU_ANALYZE_BIN = process.env.LUAU_ANALYZE_BIN || 'luau-analyze';
const JOB_ROOT = process.env.LUAU_JOB_DIR || path.join(os.tmpdir(), 'luau-jobs');

/**
 * `luau-analyze --formatter=plain` emits, verbatim:
 *   ./main.luau:2:10-10: (W0) SyntaxError: Expected identifier …
 *   ./main.luau:2:11-30: (W0) TypeError: Unknown global 'foo'
 * Older builds use the `file(line,col):` form, so both are accepted.
 */
const ANALYZE_RE = /^(?:.*?):(\d+):(\d+)(?:-\d+)?:\s*(?:\(W\d+\)\s*)?(?:([A-Za-z]+):\s*)?(.*)$/;
const ANALYZE_PAREN_RE = /^(?:.*?)\((\d+),(\d+)\):\s*(?:([A-Za-z]+):\s*)?(.*)$/;
/** The `luau` CLI reports both syntax and runtime problems as `file:line: message`. */
const RUNTIME_RE = /^(?:.*?):(\d+):\s*(.*)$/;

async function ensureJobRoot() {
  await fs.mkdir(JOB_ROOT, { recursive: true, mode: 0o700 });
}

/**
 * Spawns a command with hard rlimits and a wall-clock timeout.
 * @returns {Promise<{ stdout: string, stderr: string, code: number|null, signal: string|null,
 *                     timedOut: boolean, truncated: boolean, durationMs: number }>}
 */
function runGuarded(command, args, { cwd, timeoutMs, maxOutput, memoryMb = limits.memoryMb }) {
  return new Promise((resolve) => {
    const quoted = [command, ...args].map((part) => `'${String(part).replace(/'/g, `'\\''`)}'`).join(' ');
    const ulimits = [
      `ulimit -v ${memoryMb * 1024}`,          // address space, in KiB
      `ulimit -t ${limits.cpuSeconds}`,        // CPU seconds
      `ulimit -f ${limits.maxFileKb}`,         // file size, in KiB blocks
      `ulimit -n ${limits.maxOpenFiles}`,      // open file descriptors
      'ulimit -c 0',                           // no core dumps
    ].join('; ');

    const child = spawn('/bin/sh', ['-c', `${ulimits}; exec ${quoted}`], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      // A deliberately minimal environment: no tokens, no proxy settings,
      // nothing inherited from the worker process.
      env: {
        PATH: '/usr/local/bin:/usr/bin:/bin',
        HOME: cwd,
        TMPDIR: cwd,
        LANG: 'C.UTF-8',
      },
      detached: true, // own process group, so a fork bomb dies with one kill
    });

    const startedAt = process.hrtime.bigint();
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    let finished = false;

    const kill = (signal) => {
      try {
        process.kill(-child.pid, signal); // negative pid == the whole group
      } catch {
        try { child.kill(signal); } catch { /* already gone */ }
      }
    };

    const collect = (stream, isError) => {
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        if (truncated) return;
        bytes += Buffer.byteLength(chunk, 'utf8');
        if (bytes > maxOutput) {
          truncated = true;
          const room = Math.max(0, maxOutput - (bytes - Buffer.byteLength(chunk, 'utf8')));
          const kept = chunk.slice(0, room);
          if (isError) stderr += kept; else stdout += kept;
          kill('SIGKILL');
          return;
        }
        if (isError) stderr += chunk; else stdout += chunk;
      });
      stream.on('error', () => { /* the process is going away anyway */ });
    };

    collect(child.stdout, false);
    collect(child.stderr, true);

    const timer = setTimeout(() => {
      timedOut = true;
      kill('SIGKILL');
    }, timeoutMs);

    const finish = (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        code,
        signal,
        timedOut,
        truncated,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
      });
    };

    child.on('error', (error) => {
      stderr += `\n[sandbox] failed to start: ${error.code || error.message}`;
      finish(null, null);
    });
    child.on('close', (code, signal) => finish(code, signal));
  });
}

/** Parses an analyser diagnostic line into structured form. */
function parseDiagnostic(line, lineOffset) {
  const text = line.trim();
  if (!text) return null;
  const match = ANALYZE_PAREN_RE.exec(text) || ANALYZE_RE.exec(text);
  if (!match) return null;
  const message = match[4].trim();
  if (!message) return null;
  return {
    line: Math.max(1, Number.parseInt(match[1], 10) - lineOffset),
    column: Number.parseInt(match[2], 10),
    category: match[3] || 'Error',
    message,
  };
}

/** Parses `main.luau:12: message` runtime errors. */
function parseRuntimeError(stderr, lineOffset) {
  const lines = String(stderr).split(/\r?\n/).filter((line) => line.trim());
  for (const line of lines) {
    // Skip the trailing `stacktrace:` block the CLI prints after the message.
    if (/^stack\s?(trace|backtrace)/i.test(line) || /^\s/.test(line)) continue;
    const match = RUNTIME_RE.exec(line.trim());
    if (match && match[2].trim()) {
      return {
        line: Math.max(1, Number.parseInt(match[1], 10) - lineOffset),
        column: null,
        category: /Expected|Malformed|Unexpected|near|Incomplete/i.test(match[2]) ? 'SyntaxError' : 'RuntimeError',
        message: match[2].trim(),
      };
    }
    const structured = parseDiagnostic(line, lineOffset);
    if (structured) return structured;
  }
  const first = lines.find((line) => line.trim() && !/^stack\s?(trace|backtrace)/i.test(line));
  return first ? { line: null, column: null, category: 'RuntimeError', message: first.trim() } : null;
}

/** Drops the sandbox's own file path out of any message shown to the user. */
function scrub(text, jobDir) {
  return String(text ?? '')
    .split(jobDir).join('')
    .replace(/\/tmp\/luau-jobs\/[A-Za-z0-9_-]+\/?/g, '')
    .replace(/^\/+/gm, '')
    .trim();
}

async function withJobDir(handler) {
  await ensureJobRoot();
  const jobDir = path.join(JOB_ROOT, crypto.randomUUID());
  await fs.mkdir(jobDir, { mode: 0o700 });
  try {
    return await handler(jobDir);
  } finally {
    // The environment is disposable: nothing a program wrote survives the job.
    await fs.rm(jobDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}

/**
 * Executes Luau source and returns a structured result.
 * @param {string} source
 * @returns {Promise<object>}
 */
async function run(source) {
  return withJobDir(async (jobDir) => {
    const file = path.join(jobDir, 'main.luau');
    await fs.writeFile(file, `${PRELUDE_LINE}\n${source}\n`, { mode: 0o400 });

    const result = await runGuarded(LUAU_BIN, [file], {
      cwd: jobDir,
      timeoutMs: limits.timeoutMs,
      maxOutput: limits.maxOutput,
    });

    const stdout = scrub(result.stdout, jobDir);
    const stderr = scrub(result.stderr, jobDir);

    if (result.timedOut) {
      return {
        status: 'timeout',
        stdout,
        stderr: '',
        durationMs: Math.round(result.durationMs),
        truncated: result.truncated,
        limitMs: limits.timeoutMs,
      };
    }

    if (result.truncated) {
      return {
        status: 'output_limit',
        stdout,
        stderr: '',
        durationMs: Math.round(result.durationMs),
        truncated: true,
        limitBytes: limits.maxOutput,
      };
    }

    if (result.code === 0) {
      return {
        status: 'success',
        stdout,
        stderr,
        durationMs: Math.round(result.durationMs),
        truncated: false,
      };
    }

    // Luau rejects a malformed chunk before executing a single instruction, so
    // "nothing was printed" plus a syntax-shaped message means a compile error.
    const diagnostic = parseRuntimeError(stderr, PRELUDE_LINE_COUNT);
    const isCompileError = Boolean(diagnostic) && diagnostic.category === 'SyntaxError' && !stdout;

    return {
      status: isCompileError ? 'compile_error' : 'runtime_error',
      stdout,
      stderr,
      diagnostic,
      exitCode: result.code,
      signal: result.signal,
      durationMs: Math.round(result.durationMs),
      truncated: false,
      // Luau's allocator reports the rlimit as a clean "not enough memory"
      // error; a bare SIGKILL with no timeout means the kernel got there first.
      memoryExceeded:
        /not enough memory|out of memory|OutOfMemory/i.test(stderr) ||
        (result.signal === 'SIGKILL' && !result.timedOut),
    };
  });
}

/**
 * Type-checks and syntax-checks source without executing it.
 * The prelude is intentionally NOT prepended here, so reported line numbers
 * already match the user's source exactly.
 */
async function compile(source) {
  return withJobDir(async (jobDir) => {
    const file = path.join(jobDir, 'main.luau');
    await fs.writeFile(file, `${source}\n`, { mode: 0o400 });

    const result = await runGuarded(LUAU_ANALYZE_BIN, ['--formatter=plain', file], {
      cwd: jobDir,
      timeoutMs: limits.timeoutMs,
      maxOutput: limits.maxOutput,
      memoryMb: limits.analyzeMemoryMb,
    });

    // `luau-analyze` exits 0 even when it reports a SyntaxError, so the parsed
    // diagnostics — not the exit code — decide whether the source compiles.
    const output = scrub(`${result.stdout}\n${result.stderr}`, jobDir);
    const diagnostics = output
      .split(/\r?\n/)
      .map((line) => parseDiagnostic(line, 0))
      .filter(Boolean);

    if (result.timedOut) {
      return { status: 'timeout', diagnostics: [], durationMs: Math.round(result.durationMs), limitMs: limits.timeoutMs };
    }

    const syntaxErrors = diagnostics.filter((diagnostic) => /syntax/i.test(diagnostic.category));
    const otherErrors = diagnostics.filter((diagnostic) => !/syntax/i.test(diagnostic.category));

    return {
      status: syntaxErrors.length ? 'compile_error' : 'success',
      diagnostics,
      syntaxErrors,
      warnings: otherErrors,
      lines: String(source).split(/\r?\n/).length,
      bytes: Buffer.byteLength(source, 'utf8'),
      durationMs: Math.round(result.durationMs),
      exitCode: result.code,
    };
  });
}

module.exports = { run, compile, runGuarded, parseDiagnostic, parseRuntimeError, JOB_ROOT };
