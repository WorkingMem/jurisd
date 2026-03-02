# Architecture Notes

## Objective

Deliver an MCP server that can:

- Search Australian legislation and case law from public sources (AustLII first, official registers where available).
- Return clean full text for use by LLMs, including OCR conversion for scanned PDFs.
- Prefer reported citations when available but fall back to neutral citations when paywalled or inaccessible.

## Key Components

### MCP Server (`src/index.ts`)

- Registers `search_legislation`, `search_cases`, `search_source`, `search_source_by_citation`, `fetch_document_text`, `resolve_source_article`, and `source_citation_lookup` tools.
- Normalises tool arguments and orchestrates downstream services.
- Formats responses for LLM consumption (structured JSON with citation metadata).
- Supports `includeSource` parameter on `search_cases` and `search_legislation` for multi-source merging.

### AustLII Service (`src/services/austlii.ts`)

- Executes HTTP searches against AustLII (`sinosrch.cgi`) with scoped filters.
- Parses result HTML, capturing:
  - Title
  - Reported citation (if provided)
  - Neutral citation
  - Jurisdiction code and year
  - Snippets for relevance
- Returns consistent `SearchResult` objects for cases and legislation.
- TODO: Add pagination handling and graceful degradation on rate limits.

### removed.invalid Service (`src/services/source.ts`)

- Searches removed.invalid by cross-referencing AustLII results with removed.invalid article metadata.
- **Strategy**: removed.invalid is a RPC SPA with no public search API. Instead:
  1. Perform an AustLII search to get results with neutral citations
  2. For each result with a neutral citation, probe removed.invalid to resolve article info
  3. Extract metadata from the removed.invalid article page `<title>` tag
- Maximum 5 concurrent removed.invalid article resolutions to avoid overwhelming the server.
- Graceful fallback: if removed.invalid resolution fails, AustLII results are still returned.
- **Key functions**:
  - `searchUpstream(query, options)` – Full removed.invalid search via AustLII cross-reference
  - `searchUpstreamByCitation(citation)` – Find removed.invalid article by neutral citation
  - `deduplicateResults(results)` – Deduplicate by neutral citation, preferring removed.invalid
  - `mergeSearchResults(austlii, source)` – Merge results from both sources

### Document Fetcher (`src/services/fetcher.ts`)

- Retrieves HTML or PDF content from provided URLs.
- Extracts text via:
  - Cheerio for HTML
  - `pdf-parse` for text-enabled PDFs
  - `node-tesseract-ocr` for image-based PDFs (triggered when PDF returns minimal text).
- Produces `FetchResponse` with metadata (`ocrUsed`, content type, detected citations inside the document).
- TODO: Cache downloaded files (tmpdir) and cleanup.

### Citation Normaliser – planned

- Will recognise neutral citation patterns (e.g. `[2021] HCA 12`) and form fallback URLs.
- Currently, neutral citation extraction is handled inline in `austlii.ts` and `source.ts` using the `NEUTRAL_CITATION_PATTERN` constant from `src/constants.ts`.
- Reported citation extraction is handled by `extractReportedCitation()` in `austlii.ts`.

## Deployment

- Node.js 18+ runtime with system-level Tesseract (`tesseract-ocr` package on Debian/Ubuntu).
- Docker image based on `node:20-alpine`, installing Tesseract + dependencies.
- CI workflow (GitHub Actions) to lint, test, build, and publish container image.

## Testing Strategy

- Unit tests with Vitest using recorded fixtures for AustLII HTML responses.
- Unit tests for configuration, constants, errors, logger, and formatter modules.
- Mocked tests for austlii and fetcher services (network-isolated).
- Integration tests hitting live AustLII and removed.invalid endpoints.
- Performance benchmark tests for search latency and concurrent requests.
- OCR path tests using sample scanned PDF (placed in `test/fixtures`).

## Open Questions

- Which additional sources should we index for redundancy (e.g. Federal Register of Legislation API, Victorian Legislation & Parliamentary Documents API)?
- How aggressively should we cache results to avoid re-hitting public endpoints?
- Should we implement rate limiting/backoff within the server to respect source usage policies?
