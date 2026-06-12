# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Renamed the project from `auslaw-mcp` to `jurisd`: package name, binary, MCP server name,
  GitHub repository (`russellbrenner/jurisd`, old URLs redirect), Docker/k8s resource names,
  and documentation. Configuration env vars (`AUSLAW_*`) and the `.auslaw/` cache directory
  are unchanged.

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
  reverse-engineered GWT-RPC; see `docs/jade-gwt-protocol.md`)
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

[Unreleased]: https://github.com/russellbrenner/jurisd/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/russellbrenner/jurisd/releases/tag/v0.1.0
