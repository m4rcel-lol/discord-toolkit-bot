# ─────────────────────────────────────────────────────────────────────────────
#  Luau sandbox worker
#
#  This image runs UNTRUSTED code. It deliberately contains:
#    * no Discord token and no bot secrets (only LUAU_WORKER_TOKEN),
#    * no package manager or compiler in the final stage,
#    * no shell access for anything but /bin/sh used to apply rlimits,
#    * a non-root user with no write access anywhere except a tmpfs.
#  See docker-compose.yml for the container-level restrictions that go with it.
# ─────────────────────────────────────────────────────────────────────────────

ARG NODE_IMAGE=node:20.18.1-bookworm-slim
ARG LUAU_VERSION=0.737

# ── stage 1: obtain the Luau CLI ─────────────────────────────────────────────
FROM debian:bookworm-slim AS luau
ARG LUAU_VERSION
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip \
 && rm -rf /var/lib/apt/lists/*
COPY build-luau.sh /build-luau.sh
RUN chmod +x /build-luau.sh && /build-luau.sh "${LUAU_VERSION}" /opt/luau

# ── stage 2: runtime ─────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime

ARG LUAU_VERSION
ENV NODE_ENV=production \
    LUAU_BIN=/usr/local/bin/luau \
    LUAU_ANALYZE_BIN=/usr/local/bin/luau-analyze \
    LUAU_JOB_DIR=/tmp/luau-jobs \
    LUAU_VERSION=${LUAU_VERSION}

COPY --from=luau /opt/luau/luau /usr/local/bin/luau
COPY --from=luau /opt/luau/luau-analyze /usr/local/bin/luau-analyze

# A dedicated unprivileged user. The node image already ships `node` (uid 1000);
# we add our own so the sandbox owns nothing on the filesystem at all.
RUN groupadd --system --gid 10001 sandbox \
 && useradd --system --uid 10001 --gid 10001 --home-dir /tmp --shell /usr/sbin/nologin sandbox

WORKDIR /app
COPY --chown=root:root package.json ./
COPY --chown=root:root src ./src

# The worker has no npm dependencies, so there is nothing to install and no
# node_modules to keep up to date. Everything is read-only to the sandbox user.
RUN chmod -R a-w /app

USER sandbox

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.LUAU_WORKER_PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
