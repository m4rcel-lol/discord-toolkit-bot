'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

const { limits } = require('./limits');
const { ExecutionQueue } = require('./queue');
const executor = require('./executor');

/**
 * The sandbox worker's HTTP surface.
 *
 * It is intentionally tiny and dependency-free, listens only on the internal
 * docker network, and authenticates every request with a shared bearer token
 * compared in constant time. It never sees the Discord token: the only secret
 * it is given is LUAU_WORKER_TOKEN.
 */

const PORT = Number.parseInt(process.env.LUAU_WORKER_PORT || '8080', 10);
const TOKEN = process.env.LUAU_WORKER_TOKEN || '';
const MAX_BODY_BYTES = Math.max(limits.maxSource * 2, 65536);

const queue = new ExecutionQueue({
  maxConcurrent: limits.maxConcurrent,
  maxQueueDepth: limits.maxQueueDepth,
  queueTimeoutMs: limits.queueTimeoutMs,
});

function log(level, msg, fields = {}) {
  // Structured, and never carrying user source code or program output.
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, msg, svc: 'luau-worker', ...fields })}\n`);
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function authorised(req) {
  if (!TOKEN) return false;
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return Boolean(match) && timingSafeEqual(match[1].trim(), TOKEN);
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { code: 'BODY_TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleJob(req, res, kind) {
  let body;
  try {
    body = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    if (error.code === 'BODY_TOO_LARGE') return send(res, 413, { error: 'BODY_TOO_LARGE', message: 'Source code is too large.' });
    return send(res, 400, { error: 'BAD_JSON', message: 'Request body must be JSON.' });
  }

  const source = typeof body.source === 'string' ? body.source : '';
  if (!source.trim()) {
    return send(res, 400, { error: 'EMPTY_SOURCE', message: 'No source code was supplied.' });
  }
  const bytes = Buffer.byteLength(source, 'utf8');
  if (bytes > limits.maxSource) {
    return send(res, 413, {
      error: 'SOURCE_TOO_LARGE',
      message: `Source is ${bytes} bytes, the limit is ${limits.maxSource}.`,
      limit: limits.maxSource,
    });
  }

  const jobId = crypto.randomUUID();
  const startedAt = Date.now();
  log('info', 'job accepted', { jobId, kind, bytes, active: queue.active, waiting: queue.depth });

  try {
    const { result, waitedMs } = await queue.push(() => (kind === 'compile' ? executor.compile(source) : executor.run(source)));
    log('info', 'job finished', { jobId, kind, status: result.status, waitedMs, totalMs: Date.now() - startedAt });
    return send(res, 200, { ...result, jobId, waitedMs, limits: publicLimits() });
  } catch (error) {
    if (error.code === 'QUEUE_FULL' || error.code === 'QUEUE_TIMEOUT') {
      log('warn', 'job rejected by queue', { jobId, kind, code: error.code });
      return send(res, 503, { error: error.code, message: error.message, retryable: true });
    }
    if (error.code === 'SHUTTING_DOWN') {
      return send(res, 503, { error: error.code, message: error.message, retryable: true });
    }
    // Never leak an internal stack trace to the caller.
    log('error', 'sandbox failure', { jobId, kind, error: error.message });
    return send(res, 500, { error: 'SANDBOX_FAILURE', message: 'The sandbox failed to run that program.' });
  }
}

function publicLimits() {
  return {
    timeoutMs: limits.timeoutMs,
    memoryMb: limits.memoryMb,
    maxOutput: limits.maxOutput,
    maxSource: limits.maxSource,
    maxConcurrent: limits.maxConcurrent,
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://worker');

  if (req.method === 'GET' && url.pathname === '/health') {
    return send(res, 200, { status: 'ok', uptimeSeconds: Math.round(process.uptime()), queue: queue.snapshot() });
  }

  if (!authorised(req)) {
    return send(res, 401, { error: 'UNAUTHORISED', message: 'A valid worker token is required.' });
  }

  if (req.method === 'GET' && url.pathname === '/stats') {
    return send(res, 200, { queue: queue.snapshot(), limits: publicLimits() });
  }
  if (req.method === 'POST' && url.pathname === '/run') return handleJob(req, res, 'run');
  if (req.method === 'POST' && url.pathname === '/compile') return handleJob(req, res, 'compile');

  return send(res, 404, { error: 'NOT_FOUND', message: 'Unknown endpoint.' });
});

// Keep sockets from lingering; the bot always talks to us with short requests.
server.headersTimeout = 15000;
server.requestTimeout = 60000;
server.keepAliveTimeout = 20000;

server.on('clientError', (error, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

if (!TOKEN) {
  log('error', 'LUAU_WORKER_TOKEN is not set — refusing to start');
  process.exit(1);
}

server.listen(PORT, '0.0.0.0', () => {
  log('info', 'luau sandbox worker listening', { port: PORT, limits: publicLimits() });
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', 'shutting down', { signal });
  queue.drainForShutdown();
  server.close(() => process.exit(0));
  // Do not hang forever on a stuck socket.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (error) => log('error', 'uncaught exception', { error: error.message }));
process.on('unhandledRejection', (reason) => log('error', 'unhandled rejection', { error: String(reason) }));

module.exports = { server, queue };
