# Installing jurisd

jurisd is a Model Context Protocol (MCP) server. You install it once, register it
with an MCP-compatible client (Claude Code, Claude Desktop, Cursor), and the
client launches it over stdio on demand.

**The offline floor:** with **no API key and no network**, the local-module
recall layer still answers. Every environment variable below is optional. Direct
AustLII document fetch uses the Cloudflare-aware transport, but AustLII search
may be blocked by Cloudflare; in that case jurisd reports degraded coverage and
uses configured discovery fallbacks instead of failing silently.

## Day-0 install paths

### A. npx from GitHub (no clone)

```bash
npx -y github:russellbrenner/jurisd
```

`npx` installs the package from the built distribution and launches the server
over stdio. The first invocation does the clone and install; subsequent launches
reuse the cached install. Pin a ref by appending `#<ref>` — e.g.
`github:russellbrenner/jurisd#main`.

The native local-data package (`@duckdb/node-api`) and local embedding stack
(`@huggingface/transformers` and its native dependencies) are optional because
they pull native packages. The server still starts without the local embedding
stack: `semantic_search_local` reports that local embeddings are disabled. The
`npx` path is best for the base server; use a persistent local or global install
when you need optional local data or embedding features.

Do not use `npm_config_omit=optional` for the default server install. `impit` is
a normal production dependency, but its platform bindings are optional
subdependencies; omitting optionals strips those bindings and disables the
Cloudflare-aware AustLII transport.

### B. npm global install

Once the package is published to the npm registry, install the CLI globally with:

```bash
npm install -g jurisd
jurisd --help
```

Before the registry publish, use the GitHub tarball archive for a persistent
install:

```bash
npm install -g https://github.com/russellbrenner/jurisd/archive/refs/heads/main.tar.gz
jurisd --help
```

The tarball archive materialises the package in the global prefix and creates a
stable `jurisd` bin link. A bare git install such as `npm install -g
github:russellbrenner/jurisd` depends on npm's `install-links` setting and can
leave the global `jurisd` bin pointing at a temporary git clone that has already
been removed on hosts where `install-links=false` is configured.

If you intentionally want the bare git install form, force npm's linked install
mode:

```bash
npm install -g --install-links=true github:russellbrenner/jurisd
jurisd --help
```

## Optional native dependencies

Optional native packages must be installed into the same persistent dependency
tree that runs `jurisd`. A transient `npx github:...` cache is not a useful place
to add them manually; use a local clone or global install instead.

For a local clone:

```bash
npm install @duckdb/node-api@1.5.3-r.3
npm install @huggingface/transformers@3.7.6
```

For a global install, install the optional packages into the same global prefix:

```bash
npm install -g @duckdb/node-api@1.5.3-r.3
npm install -g @huggingface/transformers@3.7.6
```

### C. Local clone + npm

```bash
git clone https://github.com/russellbrenner/jurisd.git
cd jurisd
npm install
npm run build
npm start          # runs dist/index.js over stdio
```

For local development use `npm run dev` (hot reload) instead of `build` + `start`.

## Registering with Claude Code

The fastest path:

```bash
claude mcp add jurisd -- npx -y github:russellbrenner/jurisd
```

Or, for a local clone:

```bash
claude mcp add jurisd -- node /path/to/jurisd/dist/index.js
```

### Client config JSON

If your client edits a JSON config directly (Claude Desktop's
`claude_desktop_config.json`, or a project `.mcp.json`):

**npx (no clone):**

```json
{
  "mcpServers": {
    "jurisd": {
      "command": "npx",
      "args": ["-y", "github:russellbrenner/jurisd"]
    }
  }
}
```

**Local clone:**

```json
{
  "mcpServers": {
    "jurisd": {
      "command": "node",
      "args": ["/path/to/jurisd/dist/index.js"]
    }
  }
}
```

To pass environment variables, add an `"env": { "JADE_SESSION_COOKIE": "..." }`
block to the server entry.

### Claude Code skill

The repo ships a Claude Code skill (`skills/jurisd-research/`) that gives the agent
expert jurisd usage from day 0: tool decision guidance (local-first vs live
fallback), AGLC4 citation workflows, the typical research flow, module management,
and a worked example transcript. Install it alongside the MCP server by copying the
skill folder into your skills directory:

```bash
cp -r skills/jurisd-research ~/.claude/skills/          # user skills
# or into a plugin: cp -r skills/jurisd-research <plugin>/skills/
```

It is plain Markdown (`SKILL.md` with YAML frontmatter), so no build step is
needed. Once installed, it activates automatically on legal-research and AGLC4
prompts.

## Environment variables (all optional)

With none of these set, the local-module recall layer works, direct AustLII URLs
can still be fetched, and neutral-citation case queries can build direct AustLII
URLs. General live search needs network access and, when AustLII search is
Cloudflare-blocked, one of the configured discovery fallbacks below.

### Authentication / BYOK

| Variable              | Enables                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `JADE_SESSION_COOKIE` | jade.io citation/article resolution, the citator (citing-cases), and authenticated full-text fetch at runtime. Your own subscription cookie. |
| `ISAACUS_API_KEY`     | The optional **domain-specialised** adapter slot (rerank + extractive-QA) over local results (BYOK).                                         |
| `ISAACUS_BASE_URL`    | Override the domain-adapter endpoint (optional; defaults to the provider's base URL).                                                        |

**`JADE_SESSION_COOKIE`** — log in to jade.io in your browser, open DevTools →
Network, navigate to any article, copy the full `Cookie` request header value
(`IID=...; alcsessionid=...; cf_clearance=...`), and set it:

```bash
export JADE_SESSION_COOKIE="IID=abc123; alcsessionid=xyz789; cf_clearance=..."
```

Treat it like a password. It grants full access to your jade.io subscription. Do
not commit it; rotate if compromised.

**`ISAACUS_API_KEY`** — bring-your-own-key for the domain-adapter slot. When set
and the endpoint is reachable, the capability probe reports a
provider-interpolated label (`"Isaacus-enhanced"`) and `semantic_search_local`
reranks the local top-k. When unset or unreachable, the adapter degrades to
**baseline** (pure local cosine order) and the tool still answers. The
distinction is capability presence, framed as baseline vs domain-specialised.

### Data modules

| Variable                       | Default             | Effect                                                                                                             |
| ------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `JURISD_MODULES_DIR`           | `~/.jurisd/modules` | Install/scan root for data modules.                                                                                |
| `JURISD_MODULES_ENABLED`       | `true`              | Set `false` to disable the whole local-module layer (skip Layer 1).                                                |
| `JURISD_MODULE_STALENESS_DAYS` | `365`               | Snapshot age (days) past which a staleness advisory is attached.                                                   |
| `JURISD_MODULE_VERIFY_ON_LOAD` | `false`             | Force per-load sha256 verification (paranoid; verification is normally done at install).                           |
| `JURISD_MODELS_DIR`            | `~/.jurisd/models`  | Cache dir for the local embedding model.                                                                           |
| `JURISD_EMBED_OFFLINE`         | `false`             | Hard-fail rather than reach the network for the embedding model (air-gapped installs must pre-seed the model dir). |

### Live layer / search defaults

| Variable                  | Effect                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `LOG_LEVEL`               | `0`=DEBUG, `1`=INFO, `2`=WARN, `3`=ERROR.                                            |
| `AUSTLII_SEARCH_BASE`     | AustLII search endpoint.                                                             |
| `AUSTLII_REFERER`         | Referer header.                                                                      |
| `AUSTLII_USER_AGENT`      | User-agent string.                                                                   |
| `AUSTLII_TIMEOUT`         | Request timeout (ms).                                                                |
| `AUSTLII_CF_CLEARANCE`    | Optional pre-solved Cloudflare `cf_clearance` cookie.                                |
| `AUSLAW_USE_IMPIT`        | Set `false` to disable the default impit transport.                                  |
| `AUSTLII_TRANSPORT`       | `auto`, `impit`, or `axios` for AustLII fetches.                                     |
| `EXA_API_KEY`             | Exa key for AustLII URL discovery when native AustLII search is blocked.             |
| `EXA_SEARCH_TYPE`         | Exa search type: `auto`, `instant`, `fast`, `deep-lite`, `deep`, or `deep-reasoning`. |
| `EXA_MAX_RESULTS`         | Exa result headroom before post-filtering.                                           |
| `EXA_TIMEOUT`             | Exa request timeout (ms).                                                            |
| `AUSTLII_TAVILY_FALLBACK` | Set `true` to opt in to Tavily search fallback.                                      |
| `TAVILY_API_KEY`          | Tavily API key for AustLII search fallback.                                          |
| `TAVILY_SEARCH_DEPTH`     | Tavily search depth: `advanced` (default) or `basic`.                                |
| `TAVILY_TIMEOUT`          | Tavily request timeout (ms).                                                         |
| `TAVILY_MAX_RESULTS`      | Tavily max results, clamped to 1-20.                                                 |
| `DEFAULT_SEARCH_LIMIT`    | Default search results (default 10).                                                 |
| `MAX_SEARCH_LIMIT`        | Maximum search results (default 50).                                                 |
| `DEFAULT_OUTPUT_FORMAT`   | Default format: `json` / `text` / `markdown` / `html`.                               |
| `DEFAULT_SORT_BY`         | Default sort: `auto` / `relevance` / `date`.                                         |

When AustLII search endpoints are blocked by a Cloudflare challenge, jurisd first
uses any already-returned jade.io results. If the query contains a neutral
citation, such as `[1992] HCA 23`, it builds the canonical AustLII case URL from
the citation without calling a search provider. If no direct citation URL is
available and `EXA_API_KEY` is set, Exa is used only to discover AustLII
primary-source URLs, filtered by requested type and jurisdiction. Exa text is not
returned as source text.

If both `TAVILY_API_KEY` and `AUSTLII_TAVILY_FALLBACK=true` are set, Tavily can
also be used for candidate discovery. jurisd asks for AustLII-only primary-source
candidates, validates them against the requested type and jurisdiction, then
fetches the AustLII source document before returning result metadata. Tavily
extraction is not used for AustLII text, because direct extraction still fails on
challenged AustLII pages. Tavily calls are rate-limited, cached briefly, and
circuit-broken after provider failures so an exposed command surface does not
loop against the configured key.

See [`.env.example`](../.env.example) for a copy-paste template and `src/config.ts`
for every default.

## Installing data modules

Data modules are **operator-installed via the CLI** — deliberately off the MCP
tool surface so an AI assistant never triggers a multi-hundred-MB download
mid-conversation. Modules are published as Hugging Face datasets under the
`workingmem` organisation.

> **Status: first module published.** `legislation-cth` is available from
> `workingmem/legislation-cth` on Hugging Face. It provides Commonwealth primary
> and secondary legislation, 32,143 documents, 857,262 chunks, citation edges,
> unmatched citations, and local bge-small embeddings. Running
> `jurisd fetch-module legislation-cth` downloads the manifest and parquet files
> from Hugging Face, verifies every file against the manifest sha256 values, and
> installs the module atomically.

```bash
jurisd fetch-module <name> [--modules-dir DIR]
jurisd verify-module <name> [--modules-dir DIR]
jurisd list-modules [--modules-dir DIR]
```

`fetch-module`:

1. Resolves the module manifest from the default Hugging Face dataset URL.
2. Downloads `manifest.json` first and validates it against the vendored schema —
   checks the schema version is implemented and the release is not yanked
   **before** downloading any parquet (fail fast, save bandwidth).
3. Downloads each parquet file to a temp dir.
4. **sha256-verifies every file** against the manifest. Any mismatch aborts,
   deletes the temp dir, and exits non-zero naming the file — never installs a
   partially-verified module.
5. Installs atomically (temp-then-rename), so a half-written module never appears
   to the loader.
6. Prints the licence attribution lines (the CC-BY obligation) at install time.

`verify-module` re-runs the sha256 check against installed files on demand;
`list-modules` lists installed modules including any refused, with the reason.
Inside a conversation, `list_data_modules` is the in-band way to see what is
installed and why a module is or is not loading.

The default install root is `~/.jurisd/modules/` (override with
`JURISD_MODULES_DIR` or `--modules-dir`).

### Advanced manifest override

Use `--manifest-url URL` only when the manifest source is explicitly trusted, for
example a Hugging Face dataset and revision you operate or have independently
reviewed:

```bash
jurisd fetch-module <name> --manifest-url URL [--modules-dir DIR]
```

`verify-module` checks installed files against the manifest. It does not prove
the manifest's provenance or protect against a malicious or compromised manifest
source.

## Offline / baseline guarantee

With **no key and no network**:

- The five local-module recall tools answer from installed modules. Provision
  lookup, the Act containment tree, and the offline citation graph need only the
  optional `@duckdb/node-api` dependency.
- `semantic_search_local` embeds the query **locally** (bge-small-en-v1.5,
  384-dim, no key) when `@huggingface/transformers` is installed separately. The
  model is cached under `~/.jurisd/models/` after first use; set
  `JURISD_EMBED_OFFLINE=true` to hard-fail rather than reach the network
  (pre-seed the model dir for air-gapped installs).
- The domain-adapter slot is **baseline** (pure local cosine order). No vendor, no
  account, no network.

Optional dependencies degrade visibly: if `@duckdb/node-api` or
`@huggingface/transformers` is absent, only the feature that needs it is disabled
(reported by the capability probe and `list_data_modules`), and the rest of the
server is unaffected. The live AustLII layer additionally needs network but never
a key.

## Docker and Kubernetes

For container and k3s deployment, see [DOCKER.md](DOCKER.md) and
[../k8s/README.md](../k8s/README.md). Store
`JADE_SESSION_COOKIE` and `ISAACUS_API_KEY` in a Kubernetes Secret (not a
ConfigMap) and reference them via `envFrom` or `env[].valueFrom.secretKeyRef`.
