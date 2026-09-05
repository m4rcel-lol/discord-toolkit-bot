'use strict';

/**
 * Resource limits for the sandbox.
 *
 * Every value is clamped to a hard maximum here. Even if somebody sets an
 * absurd environment variable — or manages to influence the request body —
 * the sandbox will never run with limits looser than these bounds.
 */

function int(name, fallback, min, max) {
  const raw = process.env[name];
  const parsed = raw === undefined || raw === '' ? fallback : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const limits = {
  /** Wall-clock limit for a single program. */
  timeoutMs: int('LUAU_TIMEOUT_MS', 3000, 250, 15000),
  /** Address-space limit (`ulimit -v`) handed to the Luau process. */
  memoryMb: int('LUAU_MEMORY_MB', 64, 16, 512),
  /** Maximum bytes of stdout+stderr captured before the process is killed. */
  maxOutput: int('LUAU_MAX_OUTPUT', 16000, 256, 200000),
  /** Maximum size of accepted source code, in bytes. */
  maxSource: int('LUAU_MAX_SOURCE', 20000, 128, 200000),
  /** Programs allowed to run at the same time. */
  maxConcurrent: int('LUAU_MAX_CONCURRENT', 4, 1, 32),
  /** How long a job may wait for a free slot. */
  queueTimeoutMs: int('LUAU_QUEUE_TIMEOUT_MS', 10000, 1000, 60000),
  /** Maximum jobs waiting for a slot before new ones are rejected outright. */
  maxQueueDepth: int('LUAU_MAX_QUEUE_DEPTH', 32, 1, 512),
  /** Maximum bytes the program may write to disk (`ulimit -f`). */
  maxFileKb: int('LUAU_MAX_FILE_KB', 512, 0, 8192),
  /** File descriptors the program may hold open (`ulimit -n`). */
  maxOpenFiles: int('LUAU_MAX_OPEN_FILES', 64, 16, 1024),
};

/**
 * The CPU-seconds ceiling. Wall-clock is enforced by us; this is a second,
 * kernel-enforced belt-and-braces limit for a program that ignores signals.
 */
limits.cpuSeconds = Math.max(1, Math.ceil(limits.timeoutMs / 1000) + 1);

/**
 * `luau-analyze` never executes user code — it only parses and type-checks —
 * and it is multi-threaded, so it needs materially more address space than the
 * VM does just to allocate thread stacks. It gets its own (still bounded)
 * allowance rather than being squeezed into the runtime memory limit.
 */
limits.analyzeMemoryMb = Math.max(256, limits.memoryMb);

module.exports = { limits };
