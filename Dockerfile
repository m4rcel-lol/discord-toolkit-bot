# ─────────────────────────────────────────────────────────────────────────────
#  m5rcel's tool doggy — bot container
#
#  Holds the Discord token. Runs no user-supplied code: everything submitted to
#  /luau is forwarded to the separate `luau-worker` service.
# ─────────────────────────────────────────────────────────────────────────────
ARG NODE_IMAGE=node:20.18.1-bookworm-slim

# ── stage 1: dependencies ────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# `npm ci` when there is a lockfile (reproducible), `npm install` otherwise.
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --no-audit --no-fund; \
    else npm install --omit=dev --no-audit --no-fund; fi \
 && npm cache clean --force

# ── stage 2: runtime ─────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production \
    HEALTH_FILE=/tmp/tool-doggy-health.json

WORKDIR /app

# Tini reaps zombies and forwards SIGTERM, so shutdown stays graceful.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps --chown=root:root /app/node_modules ./node_modules
COPY --chown=root:root package.json ./
COPY --chown=root:root src ./src
COPY --chown=root:root scripts ./scripts

# The bot never writes to its own image.
RUN chmod -R a-w /app

# `node` (uid 1000) ships with the base image and owns nothing here.
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD ["node", "scripts/healthcheck.js"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/index.js"]
