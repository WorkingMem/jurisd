# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

No changes yet.

## [0.4.0] - 2026-06-22

### Added

- Added direct AustLII case URL synthesis for neutral-citation queries, so
  searches such as `[2018] HCA 9` can return the canonical AustLII URL without
  calling AustLII search or a paid discovery provider.
- Added machine-readable Exa fallback status (`ok`, `not_configured`, `failed`)
  to degraded search responses so missing keys and provider failures are visible
  instead of silently collapsing to an empty result set.
- Added `docs/RELEASE.md` with the npm trusted-publishing setup and 0.4.0 tag
  checklist.

### Changed

- Hardened Exa fallback filtering by requested type and jurisdiction, canonical
  AustLII URL host, and current Exa search-type values.
- Hardened AustLII fetch source integrity by rejecting redirects whose final URL
  leaves the AustLII origin.
- Render fetched-document HTML output from escaped source text rather than
  replaying preserved provider HTML.
- Updated AustLII fallback docs to distinguish direct citation URL resolution,
  Exa search discovery, jade.io, and visible degraded coverage.

### Packaging

- Bumped the npm package version to `0.4.0`.
- Extended the tag-triggered release workflow to validate generated artefacts,
  lint, formatting, tests, package contents, and npm trusted publishing before
  creating the GitHub release.

## [0.3.0] - 2026-06-21

### Added

- **Exa search fallback for AustLII** (#141): AustLII now serves a JS managed
  Cloudflare challenge across its whole origin that TLS impersonation (`impit`)
  cannot clear. `search_cases` / `search_legislation` now run the free providers
  resiliently (`Promise.allSettled`) so a Cloudflare block no longer fails the
  whole search; when the free providers return nothing, jurisd falls back to Exa
  neural search (`EXA_API_KEY`), which returns canonical `austlii.edu.au` case
  and legislation URLs.
- **Degraded-coverage reporting in the CLI** (#142): search results now report
  when coverage is degraded (a source was blocked or unreachable) instead of
  silently returning a partial set.
- **Inline TUI scaffold** (`src/tui.ts`): a first interactive terminal UI scaffold.
- **Multi-harness setup guide** (`docs/HARNESS-SETUP.md`): copy-paste MCP configs
  for Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, Cline, Continue,
  OpenAI Codex CLI, Zed, Gemini CLI, and JetBrains.

### Changed

- **Hardened AustLII Cloudflare fallbacks** (#140): degrade gracefully across the
  live layer when the AustLII origin returns a managed challenge, rather than
  fighting the fingerprint arms race.
- **Fail closed on malformed jade.io search responses**: reject and report rather
  than surfacing partial or garbled citator/search data.
- **Hardened rendered formatter output** and **package install/startup** for
  `npx`-from-GitHub and global installs (reliable `jurisd` bin linking and build
  for GitHub installs).

### Packaging

- **npm-publishable**: the published tarball now ships `NOTICE` and
  `LICENSE-THIRD-PARTY.md` (Apache-2.0 §4(d) NOTICE-distribution requirement) and
  is verified to contain no test artifacts; the vendored data-module manifest
  schema (`dist/data/manifest.schema.json`) ships for offline manifest validation.

### Documentation

- Documented the first published data module, `legislation-cth` on Hugging Face
  (`workingmem/legislation-cth`): Commonwealth primary and secondary legislation,
  32,143 documents, 857,262 chunks, citation edges, and local bge-small
  embeddings, installed via `jurisd fetch-module legislation-cth` (#133, #139).
- Clarified the GitHub install commands (tarball archive vs bare git install and
  the `install-links` caveat).

## [0.2.0] - 2026-06-16

### Added

- **Local-module data layer**: a Layer-1 offline recall path over installed
  parquet **data modules**. Adds a module store/loader
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
  glibc Node 26; builds TS in a discarded builder, then a slim runtime carrying only
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

- **BREAKING**: Consolidated the MCP tool surface from 18 tools to 10 (tool-surface
  consolidation). Variants of a single intent are now merged behind a
  `mode`/`op`/`action`/`by` discriminator. Underlying behaviour is unchanged; only tool names
  and input shapes changed. No aliases are provided for the old names (pre-1.0 breaking cut).

  | Old tool                 | New tool                                                         |
  | ------------------------ | ---------------------------------------------------------------- |
  | `format_citation`        | `format_citation` with `mode: full` (default)                    |
  | `format_short_citation`  | `format_citation` with `mode: short\|ibid\|subsequent`           |
  | `generate_pinpoint`      | `format_citation` with `mode: pinpoint`                          |
  | `validate_citation`      | `resolve_citation` with `mode: validate`                         |
  | `search_by_citation`     | `resolve_citation` with `mode: auto` (default) or `mode: search` |
  | `resolve_jade_article`   | `jade_lookup` with `by: article_id`                              |
  | `jade_citation_lookup`   | `jade_lookup` with `by: citation`                                |
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

### Removed

- Removed the Tesseract OCR fallback for scanned PDFs in `fetch_document_text` (`pdf-parse` digital-text extraction retained).

### Documentation

- Day-0 front-door docs overhaul for public release: rewrote `README.md` around the
  local-first three-layer story (local data modules → live AustLII → OALC fallback), a
  grouped 15-tool table, the data-module / `fetch-module` / baseline-vs-domain-specialised /
  BYOK-adapter sections, an honest quality section linking the `jurisd-data` gold-set eval
  (strict + aligned metrics), and per-source licensing notes (code Apache-2.0; module data per-source,
  AustLII excluded, VIC/NT recipe-only). Added `docs/INSTALL.md` with day-0 install paths
  (npx-from-GitHub, local clone, Claude Code config), the all-optional env-var reference, the
  `fetch-module` install flow, and the offline/baseline guarantee.
- Terminology audit across all docs: neutralised freemium-flavoured "premium" framing of the
  jade.io source to subscription/open-access wording; confirmed no stale `auslaw` prose
  references remain.

## [0.1.0] - 2026-06-12

First tagged release: a snapshot of the server as it stands. 18 MCP tools for Australian and NZ
legal research across AustLII and jade.io.

### Tools

- **Search**: `search_cases`, `search_legislation` (AustLII + jade.io results merged and
  deduplicated by neutral citation; smart query detection, jurisdiction filtering, relevance/date
  sort selection, title-match boosting), `search_by_citation`
- **Documents**: `fetch_document_text` (HTML, PDF, OCR via Tesseract; jade.io via GWT-RPC when a
  session cookie is configured), `check_source_freshness`
- **jade.io**: `resolve_jade_article`, `jade_citation_lookup`, `search_citing_cases` (citator via
  reverse-engineered GWT-RPC)
- **Citations (AGLC4)**: `format_citation`, `format_short_citation`, `validate_citation`,
  `generate_pinpoint`
- **Caching and bibliography**: `cache_citation`, `get_cached_citation`, `cache_cited_by`,
  `get_cited_by`, `list_bibliography`, `export_bibliography`

### Added

- AustLII search with authority-based ranking, pagination, and multiple search methods
- jade.io search integration via AustLII cross-referencing inside `search_cases` /
  `search_legislation` (`searchJade()`, `mergeSearchResults()`, `deduplicateResults()`); graceful
  fallback to AustLII-only results when jade.io resolution fails
- jade.io GWT-RPC protocol implementation (`proposeCitables` search, `avd2Request` fetch,
  `LeftoverRemoteService` citator)
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

[Unreleased]: https://github.com/russellbrenner/jurisd/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/russellbrenner/jurisd/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/russellbrenner/jurisd/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/russellbrenner/jurisd/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/russellbrenner/jurisd/releases/tag/v0.1.0
