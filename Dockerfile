# syntax=docker/dockerfile:1
#
# Multi-stage build for the jurisd MCP server.
#
# Base is Debian slim (glibc), not Alpine. The optional native deps that make
# the local-data layer and Cloudflare-aware fetch work — @duckdb/node-api and
# impit — ship prebuilt binaries that target glibc; musl/Alpine usually has no
# prebuild and would force a slow from-source build (or fail). glibc gets the
# prebuilt artefact for the build arch directly.

# ── Stage 1: build the TypeScript ──────────────────────────────────────────
# Base image pinned by multi-arch manifest digest (supply-chain: an immutable
# base, not a mutable tag). Update the digest with the tag when bumping Node.
FROM node:26-bookworm-slim@sha256:3fe807a03a4436e7bc76b7e84e6861899cd75c9028ae99bc00581940141ae150 AS builder

WORKDIR /app

# Install ALL deps for the build, including optionals. tsc needs the type
# declarations of the optional natives it compiles against: src/services/
# {modules,oalc}.ts reference `import("@duckdb/node-api").DuckDB*` types and
# transport.ts references `import("impit").Browser` / `HttpMethod`. Those are
# type-only references (the runtime loads the modules via dynamic import() and
# degrades when absent), but `tsc` still resolves them against node_modules at
# compile time, so omitting optionals here fails with TS2307. The builder stage
# is discarded — only dist/ is copied forward — so the heavier install costs
# nothing in the final image. devDeps (typescript) are required, so no --omit.
COPY package*.json ./
RUN npm ci

# tsconfig.build.json (extends tsconfig.json) is the project the build script
# compiles; both must be present or `tsc -p tsconfig.build.json` fails (TS5058).
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ── Stage 2: slim runtime ──────────────────────────────────────────────────
FROM node:26-bookworm-slim@sha256:3fe807a03a4436e7bc76b7e84e6861899cd75c9028ae99bc00581940141ae150 AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Production deps only (no dev, no optional), then add back the two optional
# natives the runtime actually needs:
#   - @duckdb/node-api : lazy DuckDB attach over the parquet data modules
#   - impit            : TLS-impersonating HTTP client for AustLII / Cloudflare
# --omit=optional matters here: all three optionalDependencies (the two above
# plus @huggingface/transformers) would otherwise install. transformers is the
# local embedder behind semantic_search_local; it is hundreds of MB and is
# intentionally NOT bundled to keep the image slim — that one tool degrades
# visibly (typed note) when absent, every other tool works. We then install the
# two wanted natives explicitly, pinned to the package-lock.json versions; their
# platform prebuilds (linux-{arm64,x64}-gnu) resolve directly on glibc, so no
# node-gyp / python3 / g++ build toolchain is required in this stage.
COPY package*.json ./
RUN npm ci --omit=dev --omit=optional \
 && npm install --no-save \
      @duckdb/node-api@1.5.3-r.3 \
      impit@0.14.1 \
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
