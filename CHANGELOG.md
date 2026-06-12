# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **WS-E local-module data layer**: a Layer-1 offline recall path over installed
  parquet **data modules** (`docs/design/data-layer.md`). Adds a module store/loader
  with manifest validation against a vendored schema and lazy per-module DuckDB
  attach over parquet (`src/services/modules.ts`, `src/data/`), holding metadata only
  in RSS and degrading gracefully when `@duckdb/node-api` is absent.
- **5 new MCP tools** (tool surface 10 → 15, under the 18 ceiling): `get_provision`
  (deterministic provision lookup), `get_act_structure` (recursive-CTE containment
  tree over `act_provision` edges), `find_citing` (offline twin of
  `search_citing_cases` over `cites`/`considers` edges), `semantic_search_local`
  (local bge-small query embedding + cosine ranking with facet pre-filters), and
  `list_data_modules` (registry introspection). All carry
  `metadata.source = "local_module"` with name/version/snapshot and a staleness advisory.
- **Local query embedding** (`src/services/embedder.ts`) via the optional
  `@huggingface/transformers` dependency (bge-small-en-v1.5, 384-dim, offline, no key),
  lazy-imported with graceful absence and an air-gapped `JURISD_EMBED_OFFLINE` mode.
- **Capability probe + vendor-neutral provider adapter** (`src/services/capabilities.ts`,
  `src/services/adapter.ts`): a startup probe reporting duckdb / local_embeddings /
  module counts / domain adapter, and a baseline-vs-domain-specialised adapter with an
  Isaacus BYOK rerank + extractive-QA skeleton (silent per-call degradation, no
  free/premium framing).
- **`fetch-module` CLI** (`jurisd fetch-module` / `verify-module` / `list-modules`):
  operator-driven module install with sha256 verification, fail-fast manifest validation
  before any parquet download, and atomic temp-then-rename install
  (`src/services/fetch-module.ts`, `src/cli.ts`).
- New config block (`config.modules`) and env vars: `JURISD_MODULES_DIR`,
  `JURISD_MODULES_ENABLED`, `JURISD_MODULE_STALENESS_DAYS`, `JURISD_MODULE_VERIFY_ON_LOAD`,
  `JURISD_MODELS_DIR`, `JURISD_EMBED_OFFLINE`, and `ISAACUS_API_KEY` / `ISAACUS_BASE_URL`.
- **Container image + release plumbing**: a multi-stage `Dockerfile` (Debian-slim
  glibc Node 20; builds TS in a discarded builder, then a slim runtime carrying only
  the two optional natives the server uses — `@duckdb/node-api` and `impit` — while
  `@huggingface/transformers` stays unbundled to keep the image small), a
  `docker-compose.yaml` smoke-test/build example honest about the stdio per-invocation
  model (idle container + `exec` handshake, not a long-lived daemon), a `.dockerignore`,
  a `scripts/docker-handshake.mjs` stdio `initialize`+`tools/list` verifier (docker or
  podman; asserts the 15-tool surface), and `docs/DOCKER.md` covering Claude Code wiring
  (`docker run -i ...`), `/data/modules` volume mounting via `JURISD_MODULES_DIR`, and the
  container env vars.
- **`jurisd-research` Claude Code skill** (`skills/jurisd-research/`): a bundled skill
  giving the agent expert jurisd usage from day 0 — tool decision guidance (local-first
  vs live fallback, `resolve_citation` vs `search_cases`, `find_citing` vs
  `search_citing_cases`), AGLC4 citation workflows, the typical research flow, module
  management, and a worked example transcript (`examples/research-session.md`).
  Documented in the README and `docs/INSTALL.md` (copy into `~/.claude/skills/`).

### Changed

- **BREAKING**: Consolidated the MCP tool surface from 18 tools to 10 per the R5 decision
  (`docs/decisions/tool-surface.md`). Variants of a single intent are now merged behind a
  `mode`/`op`/`action`/`by` discriminator. Underlying behaviour is unchanged; only tool names
  and input shapes changed. No aliases are provided for the old names (pre-1.0 breaking cut).

  | Old tool                 | New tool                                                         |
  | ------------------------ | ---------------------------------------------------------------- |
  | `format_citation`        | `format_citation` with `mode: full` (default)                    |
  | `format_short_citation`  | `format_citation` with `mode: short\|ibid\|subsequent`           |
  | `generate_pinpoint`      | `format_citation` with `mode: pinpoint`                          |
  | `validate_citation`      | `resolve_citation` with `mode: validate`                         |
  | `search_by_citation`     | `resolve_citation` with `mode: auto` (default) or `mode: search` |
  | `resolve_source_article`   | `source_lookup` with `by: article_id`                              |
  | `source_citation_lookup`   | `source_lookup` with `by: citation`                                |
  | `cache_citation`         | `cite` with `action: add` (default)                              |
  | `check_source_freshness` | `cite` with `action: refresh_source`                             |
  | `get_cached_citation`    | `bibliography` with `op: get`                                    |
  | `list_bibliography`      | `bibliography` with `op: list` (default)                         |
  | `export_bibliography`    | `bibliography` with `op: export`                                 |
  | `get_cited_by`           | `bibliography` with `op: cited_by`                               |

  Unchanged: `search_legislation`, `search_cases`, `fetch_document_text`,
  `search_citing_cases`, `cache_cited_by`.

- Split server construction out of the entry point: `src/server.ts` exports
  `createMcpServer()` (tool registration); `src/index.ts` retains transport wiring only.
- Renamed the project from `auslaw-mcp` to `jurisd`: package name, binary, MCP server name,
  GitHub repository (`russellbrenner/jurisd`, old URLs redirect), Docker/k8s resource names,
  and documentation. Configuration env vars (`AUSLAW_*`) and the `.auslaw/` cache directory
  are unchanged.

### Documentation

- Day-0 front-door docs overhaul for public release: rewrote `README.md` around the
  local-first three-layer story (local data modules → live AustLII → OALC fallback), a
  grouped 15-tool table, the data-module / `fetch-module` / baseline-vs-domain-specialised /
  BYOK-adapter sections, an honest quality section linking the `jurisd-data` gold-set eval
  (strict + aligned metrics), and per-source licensing notes (code MIT; module data per-source,
  AustLII excluded, VIC/NT recipe-only). Added `docs/INSTALL.md` with day-0 install paths
  (npx-from-GitHub, local clone, Claude Code config), the all-optional env-var reference, the
  `fetch-module` install flow, and the offline/baseline guarantee.
- Terminology audit across all docs: neutralised freemium-flavoured "premium" framing of the
  removed.invalid source to subscription/open-access wording; confirmed no stale `auslaw` prose
  references remain.

## [0.1.0] - 2026-06-12

First tagged release: a snapshot of the server as it stands. 18 MCP tools for Australian and NZ
legal research across AustLII and removed.invalid.

### Tools

- **Search**: `search_cases`, `search_legislation` (AustLII + removed.invalid results merged and
  deduplicated by neutral citation; smart query detection, jurisdiction filtering, relevance/date
  sort selection, title-match boosting), `search_by_citation`
- **Documents**: `fetch_document_text` (HTML, PDF, OCR via Tesseract; removed.invalid via RPC when a
  session cookie is configured), `check_source_freshness`
- **removed.invalid**: `resolve_source_article`, `source_citation_lookup`, `search_citing_cases` (citator via
  reverse-engineered RPC; see `docs/source-rpc-protocol.md`)
- **Citations (AGLC4)**: `format_citation`, `format_short_citation`, `validate_citation`,
  `generate_pinpoint`
- **Caching and bibliography**: `cache_citation`, `get_cached_citation`, `cache_cited_by`,
  `get_cited_by`, `list_bibliography`, `export_bibliography`

### Added

- AustLII search with authority-based ranking, pagination, and multiple search methods
- removed.invalid search integration via AustLII cross-referencing inside `search_cases` /
  `search_legislation` (`searchUpstream()`, `mergeSearchResults()`, `deduplicateResults()`); graceful
  fallback to AustLII-only results when removed.invalid resolution fails
- removed.invalid RPC protocol implementation (`resolveRecords` search, `fetchRequest` fetch,
  `RemoteService` citator)
- Citation extraction and AGLC4 formatting (neutral and reported formats, paragraph-number
  preservation for pinpoints)
- Source store and citation cache with bibliography export
- SSRF URL allowlist guard, per-host rate limiting, and cookie-scrubbing in error paths
- Structured logging, typed error classes (`AustLiiError`, `NetworkError`, `ParseError`,
  `OcrError`), config and constants modules
- CI: lint + typecheck + Node 20/22 test matrix + npm audit; Docker build; TypeDoc docs sync;
  tag-triggered release workflow
- Unit, integration (live-service), and performance test suites; ESLint v9 flat config; Prettier
- SECURITY.md, CONTRIBUTING.md, architecture documentation

### Security

- Source-store citeKey hardening against path traversal (#108)
- Dependency updates resolving known HIGH severity advisories; npm audit in CI

[Unreleased]: https://github.com/russellbrenner/jurisd/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/russellbrenner/jurisd/releases/tag/v0.1.0
