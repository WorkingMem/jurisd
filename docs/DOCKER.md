# Running jurisd in Docker

jurisd ships as a multi-stage container image: a Debian-slim Node 26 runtime
with the compiled server and the two native dependencies that make the
local-data and Cloudflare-aware fetch paths work (`@duckdb/node-api`, `impit`).

> jurisd is a **stdio MCP server**. It does not expose a long-lived HTTP daemon
> by default. An MCP client (Claude Code, Claude Desktop) spawns the container
> per session and drives JSON-RPC over the container's stdin/stdout. Keep that
> model in mind throughout this guide.

## Build

```bash
docker build -t jurisd:latest .
# or, with podman (drop-in):
podman build -t jurisd:latest .
```

The build:

1. **builder stage** runs a full `npm ci` then `npm run build` to emit `dist/`.
   The optionals are installed here on purpose: `tsc` compiles type-only
   references such as `import("@duckdb/node-api").DuckDBInstance` (modules.ts,
   oalc.ts) and `import("impit").Browser` (transport.ts), which resolve against
   `node_modules` at compile time even though the runtime loads those modules via
   dynamic `import()` and degrades when they are absent. Omitting optionals here
   fails the build with `TS2307`. The builder stage is discarded — only `dist/`
   is copied forward — so the heavier install does not affect the final image.
2. **runtime stage** installs production deps with `--omit=optional`, then
   explicitly adds back `@duckdb/node-api` and `impit` (the two optionals the
   running server uses), copies `dist/`, drops to a non-root user, and sets
   `JURISD_MODULES_DIR=/data/modules`.

`@huggingface/transformers` (the local embedder behind `semantic_search_local`)
is **not** bundled, to keep the image slim. That single tool degrades visibly
(returns a typed note) when the embedder is absent; every other tool works.

### Architecture note

The image is built for the host architecture. `@duckdb/node-api` and `impit`
publish prebuilt binaries for `linux-x64-gnu` and `linux-arm64-gnu`. On Apple
Silicon (podman/Docker Desktop default arm64 VM) you get the arm64 prebuild; on
an x86 host, the x64 prebuild. Cross-building for a different arch requires
`--platform` and an emulator (qemu/binfmt); the prebuilds still resolve because
they are glibc-targeted (this is why the base is `node:26-bookworm-slim`, not
Alpine/musl).

## Use with Claude Code

A stdio MCP client launches the server itself with `-i` so it owns stdin/stdout.
Add jurisd to your MCP client config pointing at `docker run`:

```json
{
  "mcpServers": {
    "jurisd": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "jurisd:latest"]
    }
  }
}
```

With data modules mounted (see below):

```json
{
  "mcpServers": {
    "jurisd": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-v",
        "/absolute/path/to/modules:/data/modules:ro",
        "jurisd:latest"
      ]
    }
  }
}
```

`claude mcp add` equivalent:

```bash
claude mcp add jurisd -- docker run -i --rm \
  -v "$HOME/.jurisd/modules:/data/modules:ro" jurisd:latest
```

Key points:

- `-i` is mandatory: without it the container has no stdin and the server reads
  EOF and exits immediately.
- `--rm` cleans up the per-session container.
- Do **not** add `-t` (a TTY corrupts the JSON-RPC byte stream).

## Mounting data modules

Installed parquet data modules give jurisd its offline local-recall tools
(`get_provision`, `get_act_structure`, `find_citing`, `semantic_search_local`,
`list_data_modules`). The loader reads them from the directory named by
`JURISD_MODULES_DIR`, which the image sets to `/data/modules`.

Mount your module directory there:

```bash
docker run -i --rm \
  -v "$HOME/.jurisd/modules:/data/modules:ro" \
  jurisd:latest
```

Each module is a subdirectory containing `manifest.json` plus the four parquet
files (`documents`, `chunks`, `edges`, `unmatched_citations`). With nothing
mounted, the live AustLII/removed.invalid tools and citation tools still work; only the
local-recall tools report "no modules" (degrade-visibly).

To point the loader somewhere other than `/data/modules`, override the env var:

```bash
docker run -i --rm \
  -e JURISD_MODULES_DIR=/srv/law \
  -v "$HOME/law:/srv/law:ro" \
  jurisd:latest
```

## Environment variables

All config is environment-driven (`src/config.ts`). The ones that matter most
for a containerised run:

| Variable                       | Default                 | Purpose                                                                 |
| ------------------------------ | ----------------------- | ----------------------------------------------------------------------- |
| `JURISD_MODULES_DIR`           | `/data/modules` (image) | Root dir for installed parquet data modules.                            |
| `JURISD_MODULES_ENABLED`       | `true`                  | Set `false` to disable the whole local-module layer.                    |
| `JURISD_MODULE_STALENESS_DAYS` | `365`                   | Snapshot age (days) before a staleness advisory is attached.            |
| `JURISD_MODULE_VERIFY_ON_LOAD` | `false`                 | sha256-verify each parquet against the manifest on load.                |
| `JURISD_MODELS_DIR`            | `~/.jurisd/models`      | Embedder model cache (only used if transformers is added to the image). |
| `JURISD_EMBED_OFFLINE`         | `false`                 | Hard-fail instead of fetching the embedder model over the network.      |
| `SESSION_COOKIE`          | _(unset)_               | removed.invalid session cookie for authenticated search/fetch.                  |
| `AUSTLII_TIMEOUT`              | `60000`                 | AustLII request timeout (ms); AustLII is slow.                          |
| `AUSTLII_CF_CLEARANCE`         | _(unset)_               | Reuse an already-solved Cloudflare `cf_clearance` cookie.               |
| `AUSLAW_USE_IMPIT`             | `true`                  | Use the impit TLS-impersonating client for AustLII (needs impit).       |
| `MCP_TRANSPORT`                | _(unset → stdio)_       | Set to `http` to serve streamable HTTP on `PORT` (default 3000).        |

Pass with `-e KEY=value` or `--env-file .env` (see `.env.example`).

```bash
docker run -i --rm \
  --env-file .env \
  -v "$HOME/.jurisd/modules:/data/modules:ro" \
  jurisd:latest
```

## Docker Compose

`docker-compose.yaml` is for **building** and **smoke-testing**, not for serving
a client. Because the server is stdio, the compose service idles
(`entrypoint: sleep infinity`) so you can `exec` a handshake into it. See the
comments in that file. A real client should call `docker run -i ...` directly.

```bash
docker compose build
docker compose up -d
# one fresh server invocation per exec, fed a JSON-RPC handshake:
docker compose exec -T jurisd node dist/index.js < handshake.jsonl
docker compose down
```

## Verifying the image

`scripts/docker-handshake.mjs` drives the stdio `initialize` + `tools/list`
exchange and asserts the tool count (15):

```bash
node scripts/docker-handshake.mjs --engine docker --image jurisd:latest
```

It prints the server name/version and the sorted tool list, exiting non-zero on
mismatch. Use `--engine podman` for podman, or run against a host build with:

```bash
node scripts/docker-handshake.mjs -- node dist/index.js
```

## HTTP transport (optional)

For a long-lived HTTP endpoint (e.g. behind a gateway) set `MCP_TRANSPORT=http`.
The server then listens on `PORT` (default 3000) and exposes `/health`:

```bash
docker run --rm -p 3000:3000 -e MCP_TRANSPORT=http jurisd:latest
curl localhost:3000/health   # {"status":"ok"}
```

This is a stateless streamable-HTTP transport (a fresh MCP server per request);
most users want the default stdio mode above.

## Troubleshooting

- **Container exits immediately** — you ran without `-i`. The stdio server needs
  an attached stdin.
- **Garbled output / client can't parse** — you passed `-t`. Drop the TTY flag;
  JSON-RPC must be raw bytes.
- **`local-module query tools are disabled`** in stderr — `@duckdb/node-api`
  failed to load. Confirm the image built the runtime install step and that the
  build arch matches the run arch.
- **`semantic_search_local disabled`** — expected: the embedder
  (`@huggingface/transformers`) is not bundled. Build a fat image by adding it
  to the runtime install if you need offline semantic search.

```

```
