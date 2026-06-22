# syntax=docker/dockerfile:1
#
# Multi-stage build for the jurisd MCP server.
#
# Base is Debian slim (glibc), not Alpine. The native deps that make the
# local-data layer and Cloudflare-aware fetch work ship prebuilt binaries that
# target glibc; musl/Alpine usually has no prebuild and would force a slow
# from-source build (or fail). glibc gets the prebuilt artefact for the build
# arch directly.

# ── Stage 1: build the TypeScript ──────────────────────────────────────────
# Base image pinned by multi-arch manifest digest (supply-chain: an immutable
# base, not a mutable tag). Update the digest with the tag when bumping Node.
FROM node:26-bookworm-slim@sha256:4e2e85a824f938e41a61e9e819f0c7c11432f7d60f470b96214d3ead2f0dd63e AS builder

WORKDIR /app

# Install ALL deps for the build, including optionals. tsc needs the type
# declarations of the optional natives it compiles against: src/services/
# {modules,oalc}.ts reference `import("@duckdb/node-api").DuckDB*` types.
# Those are type-only references (the runtime loads DuckDB via dynamic import()
# and degrades when absent), but `tsc` still resolves them against node_modules
# at compile time, so omitting optionals here fails with TS2307. The builder
# stage is discarded — only dist/ is copied forward — so the heavier install
# costs nothing in the final image. devDeps (typescript) are required, so no
# --omit.
COPY package*.json ./
RUN npm ci

# tsconfig.build.json (extends tsconfig.json) is the project the build script
# compiles; both must be present or `tsc -p tsconfig.build.json` fails (TS5058).
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ── Stage 2: slim runtime ──────────────────────────────────────────────────
FROM node:26-bookworm-slim@sha256:4e2e85a824f938e41a61e9e819f0c7c11432f7d60f470b96214d3ead2f0dd63e AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Production deps only, including optional native packages declared by
# production dependencies. This is required because impit's platform bindings
# are optional subdependencies even though impit itself is a normal production
# dependency. @duckdb/node-api is also included for local data modules. The
# local embedding stack is intentionally not a package dependency;
# semantic_search_local degrades visibly when that stack is absent.
COPY package*.json ./
RUN npm ci --omit=dev \
 && npm cache clean --force

# Compiled app from the builder stage.
COPY --from=builder /app/dist ./dist

# Module mount point. Installed parquet data modules are mounted here at run
# time; JURISD_MODULES_DIR points the loader (src/services/modules.ts) at it.
# See docs/DOCKER.md "Mounting data modules".
RUN mkdir -p /data/modules

# Non-root runtime user; owns /app and /data so a mounted module dir stays
# readable when chowned to this uid.
RUN groupadd -g 1001 nodejs \
 && useradd -u 1001 -g nodejs -m -s /usr/sbin/nologin nodejs \
 && chown -R nodejs:nodejs /app /data
USER nodejs

# Default config. JURISD_MODULES_DIR is the load-bearing one: it overrides the
# in-image default (~/.jurisd/modules) to the documented /data/modules mount.
ENV JURISD_MODULES_DIR=/data/modules \
    AUSTLII_SEARCH_BASE=https://www.austlii.edu.au/cgi-bin/sinosrch.cgi \
    AUSTLII_REFERER=https://www.austlii.edu.au/forms/search1.html \
    AUSTLII_TIMEOUT=60000

# HTTP transport port, used only when MCP_TRANSPORT=http. The default stdio
# transport ignores this.
EXPOSE 3000

# jurisd speaks MCP over stdio by default. Run with `-i` so the client can
# drive the JSON-RPC handshake on stdin/stdout (see docs/DOCKER.md).
ENTRYPOINT ["node", "dist/index.js"]
