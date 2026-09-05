'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { logger } = require('./utils/logger');

/**
 * Liveness signal for the container healthcheck.
 *
 * The bot has no HTTP surface, so instead of inventing one it writes a small
 * heartbeat file while the gateway connection is healthy. `scripts/healthcheck.js`
 * reads it back; a stale or missing file means the shard is gone and Docker
 * should restart us.
 */

const HEARTBEAT_FILE = process.env.HEALTH_FILE || path.join(os.tmpdir(), 'tool-doggy-health.json');
const INTERVAL_MS = 15000;
/** How old the heartbeat may get before the container counts as unhealthy. */
const MAX_AGE_MS = 60000;

function writeHeartbeat(client) {
  try {
    fs.writeFileSync(
      HEARTBEAT_FILE,
      JSON.stringify({
        at: Date.now(),
        ready: Boolean(client?.isReady?.()),
        ping: Math.round(client?.ws?.ping ?? -1),
        guilds: client?.guilds?.cache?.size ?? 0,
        uptimeSeconds: Math.round(process.uptime()),
      }),
    );
  } catch (error) {
    logger.warn('Could not write the heartbeat file', { file: HEARTBEAT_FILE, error });
  }
}

/** @returns {() => void} a function that stops the heartbeat */
function startHeartbeat(client) {
  writeHeartbeat(client);
  const timer = setInterval(() => writeHeartbeat(client), INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}

/** @returns {{ healthy: boolean, reason?: string, heartbeat?: object }} */
function checkHeartbeat() {
  let raw;
  try {
    raw = fs.readFileSync(HEARTBEAT_FILE, 'utf8');
  } catch {
    return { healthy: false, reason: 'no heartbeat file yet' };
  }

  let heartbeat;
  try {
    heartbeat = JSON.parse(raw);
  } catch {
    return { healthy: false, reason: 'heartbeat file is corrupt' };
  }

  const age = Date.now() - Number(heartbeat.at || 0);
  if (age > MAX_AGE_MS) return { healthy: false, reason: `heartbeat is ${Math.round(age / 1000)}s old`, heartbeat };
  if (!heartbeat.ready) return { healthy: false, reason: 'the gateway connection is not ready', heartbeat };
  return { healthy: true, heartbeat };
}

module.exports = { startHeartbeat, checkHeartbeat, HEARTBEAT_FILE, MAX_AGE_MS };
