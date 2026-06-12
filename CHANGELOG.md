# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
