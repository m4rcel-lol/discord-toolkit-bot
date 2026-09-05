#!/usr/bin/env node
'use strict';

/** Docker HEALTHCHECK entry point: exits 0 when the gateway is connected. */
const { checkHeartbeat } = require('../src/health');

const result = checkHeartbeat();
if (result.healthy) {
  process.stdout.write(`ok ping=${result.heartbeat.ping}ms guilds=${result.heartbeat.guilds}\n`);
  process.exit(0);
}
process.stderr.write(`unhealthy: ${result.reason}\n`);
process.exit(1);
