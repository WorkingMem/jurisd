# AI Agent Instructions for AusLaw MCP

This document provides guidance for AI agents (Claude Code, Cursor, etc.) working on this project.

## Project Overview

**AusLaw MCP** is a Model Context Protocol (MCP) server that searches Australian legal databases (AustLII, removed.invalid) and retrieves full-text judgements with citation support. It's designed for legal research workflows requiring primary source authorities.

**Primary users**: Legal researchers, law students, lawyers conducting case research
**Key requirement**: Always return the most authoritative, relevant version of legal materials

## Architecture

```
src/
├── index.ts              # MCP server setup & tool registration (9 tools)
├── config.ts             # Configuration management (env vars with defaults)
├── constants.ts          # Citation patterns, court codes, reporters, timeouts
├── errors.ts             # Custom error classes (AustLiiError, NetworkError, ParseError, OcrError)
├── services/
│   ├── austlii.ts        # AustLII search, authority scoring, sort detection
│   ├── citation.ts       # AGLC4 citation parsing, formatting, validation, pinpoints
│   ├── fetcher.ts        # Document retrieval (HTML, PDF, OCR, removed.invalid)
│   ├── source.ts           # removed.invalid article resolution, URL utilities, citation lookup
│   └── source-rpc.ts       # RPC utilities (buildFetchRequest, encodeInt, parseFetchResponse)
├── utils/
│   ├── formatter.ts      # MCP response formatting (json/text/markdown/html)
│   ├── logger.ts         # Structured levelled logging (LOG_LEVEL env var)
│   ├── rate-limiter.ts   # Token bucket rate limiter (AustLII 10 req/min, removed.invalid 5 req/min)
│   └── url-guard.ts      # SSRF protection (HTTPS-only, allowlisted hosts)
└── test/
    ├── source.test.ts          # removed.invalid integration tests (unit + live + authenticated RPC)
    ├── scenarios.test.ts     # End-to-end search scenarios (live network, skipped in CI)
    ├── fixtures/             # Static HTML fixtures for deterministic tests
    ├── performance/          # Performance benchmarks (large result sets, timing)
    └── unit/                 # Unit tests (~163 test cases)
        ├── austlii.test.ts
        ├── austlii-mock.test.ts
        ├── citation.test.ts
        ├── config.test.ts
        ├── constants.test.ts
        ├── errors.test.ts
        ├── fetcher.test.ts
        ├── fetcher-mock.test.ts
        ├── formatter.test.ts
        ├── source-rpc.test.ts
        ├── logger.test.ts
        ├── rate-limiter.test.ts
        └── url-guard.test.ts
```

## Core Principles

### 1. Primary Sources Only
- **NEVER** return journal articles, commentary, or secondary sources
- **ALWAYS** filter URLs containing `/journals/`
- Focus: Cases from `/cases/` and legislation from `/legis/`

### 2. Citation Accuracy
- Extract and preserve neutral citations: `[2025] HCA 26`
- Preserve paragraph numbers in `[N]` format
- Future: Extract page numbers for reported citations

### 3. Search Quality
- ✅ **FIXED**: Intelligent sorting now returns the actual case being searched for
- **Implementation**: Auto-detects case name queries vs topic searches
  - Case names ("X v Y", "Re X", citations) → relevance sorting
  - Topics ("negligence duty of care") → date sorting for recent cases
- **Configuration**: `sortBy` parameter supports "auto" (default), "relevance", "date"

### 4. Real-World Testing
- Tests hit live AustLII API (non-deterministic)
- Validate with actual legal queries (e.g., "negligence duty of care")
- Live tests in `src/test/scenarios.test.ts` are skipped in CI (`process.env.CI`) to avoid flaky failures
- Live test scenarios covering search quality, relevance, and sorting modes
- Deterministic unit tests use HTML fixtures from `src/test/fixtures/`

## Development Guidelines

### When Adding Features

1. **Check existing issues**: See GitHub Issues for planned work
2. **Update tests**: Add test scenarios for new functionality
3. **Maintain filtering**: Ensure journal articles remain excluded
4. **Preserve structure**: Keep paragraph numbers intact in text extraction
5. **Update docs**: Modify README.md and `docs/ROADMAP.md` as needed

### Code Style

- **TypeScript strict mode**: All code must type-check with `npm run build`
- **Error handling**: Wrap network calls in try/catch with descriptive errors
- **Interfaces first**: Define TypeScript interfaces before implementation
- **No magic strings**: Use enums/constants for repeated values

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SESSION_COOKIE` | For removed.invalid fetch | Full cookie header from an authenticated removed.invalid browser session (`IID=...; alcsessionid=...; cf_clearance=...`). Without this, `fetch_document_text` for removed.invalid URLs throws an actionable error. |
| `AUSTLII_SEARCH_BASE` | No | Override AustLII search endpoint (default: `https://www.austlii.edu.au/cgi-bin/sinosrch.cgi`) |
| `AUSTLII_REFERER` | No | Referer header for AustLII requests |
| `AUSTLII_USER_AGENT` | No | User-Agent string for AustLII requests |
| `AUSTLII_TIMEOUT` | No | AustLII request timeout in ms |
| `OCR_LANGUAGE` | No | Tesseract OCR language (default: `eng`) |
| `OCR_OEM` | No | Tesseract OCR engine mode |
| `OCR_PSM` | No | Tesseract page segmentation mode |
| `DEFAULT_SEARCH_LIMIT` | No | Default number of search results (default: 10) |
| `MAX_SEARCH_LIMIT` | No | Maximum allowed search results (default: 50) |
| `DEFAULT_OUTPUT_FORMAT` | No | Default format: `json`, `text`, `markdown`, `html` |
| `DEFAULT_SORT_BY` | No | Default sort: `auto`, `relevance`, `date` |
| `LOG_LEVEL` | No | Logging verbosity: `error`, `warn`, `info`, `debug` |

See README.md "removed.invalid Authenticated Access" for cookie extraction instructions. See `src/config.ts` for all defaults.

### Testing Requirements

Every PR must include:
- ✅ TypeScript compilation passes (`npm run build`)
- ✅ All tests pass (`npm test`)
- ✅ New tests for new features
- ✅ Tests validate real behaviour (not static mocks)

### Search Implementation Notes

**Current AustLII search** (`src/services/austlii.ts`):
- Uses `https://www.austlii.edu.au/cgi-bin/sinosrch.cgi` (configurable via `AUSTLII_SEARCH_BASE`)
- Parameters: `method=boolean`, `query=...`, `meta=/austlii`, `view=date|relevance`
- Parses `<ol><li>` result structure with Cheerio
- **Smart query detection**:
  - `isCaseNameQuery()`: Detects "X v Y", "Re X", citation patterns, quoted strings
  - `determineSortMode()`: Auto-selects appropriate sorting
  - `boostTitleMatches()`: Re-ranks results by title match score for case name queries
  - `calculateAuthorityScore()`: Weights results by court hierarchy (HCA=100, FCAFC=80, etc.)
- **Configurable sorting**: Explicit control via `sortBy` parameter when needed

**Citation service** (`src/services/citation.ts`):
- `parseCitation()`: Extracts neutral and reported citations from free text
- `formatAGLC4()`: Formats citations per AGLC4 rules (title, neutral, reported, pinpoint)
- `validateCitation()`: HEAD-checks a neutral citation against AustLII, returns canonical URL
- `generatePinpoint()`: Finds a paragraph by number or phrase in a `ParagraphBlock[]` array

**removed.invalid service** (`src/services/source.ts`):
- `searchUpstream(query, options)` calls the `resolveRecords` RPC method (reverse-engineered via HAR analysis). Returns `[]` gracefully when `SESSION_COOKIE` is unset.
- `search_cases` runs AustLII and removed.invalid in parallel, deduplicating results by neutral citation (source results preferred as they have richer citation data).
- Article metadata resolution: `resolveArticle(articleId)` fetches the page `<title>` tag to extract case name and neutral citation without needing JavaScript execution
- URL utilities: `isSourceUrl()`, `extractArticleId()`, `buildArticleUrl()`, `buildSearchUrl()`
- Citation lookup: `buildCitationLookupUrl(citation)` returns a removed.invalid search URL the user can open
- AustLII enrichment: `enrichWithSourceLinks(results)` adds a `sourceUrl` field to results that have a neutral citation
- Key exports: `searchUpstream`, `resolveArticle`, `resolveArticleFromUrl`, `articleToSearchResult`, `enrichWithSourceLinks`, `buildCitationLookupUrl`, `isSourceUrl`, `extractArticleId`

**RPC utilities** (`src/services/source-rpc.ts`):
- Low-level implementation of removed.invalid's RPC wire protocol (reverse-engineered, 2026-03-02)
- `encodeInt(n)`: Encodes integers using RPC's custom base-64 charset (A-Z, a-z, 0-9, $, _)
- `buildFetchRequest(articleId)`: Builds the POST body for `ArticleViewRemoteService.fetchRequest` — the primary method removed.invalid's RPC app uses to load article content
- `parseFetchResponse(text)`: Strips `//OK` prefix, joins RPC `"+"` string concatenation, JSON-parses, and extracts the longest HTML string from the nested string table
- `buildGetMetadataRequest(articleId)`: Lighter-weight call that returns schema.org JSON with case name and neutral citation
- Tokens and the variant hash may need refreshing if removed.invalid redeploys its RPC app (inspect `X-Variant` from a live browser session)

**Document fetching** (`src/services/fetcher.ts`):
- Handles HTML, PDF, and OCR fallback (Tesseract)
- Extracts text while preserving `[N]` paragraph markers as `ParagraphBlock[]`
- For removed.invalid URLs: routes to `fetchSourceArticleContent()` via `SESSION_COOKIE`; calls `fetchRequest` RPC to bypass the JavaScript SPA and retrieve full HTML directly
- **Limitation**: Page numbers from reported judgements not extracted

## Common Tasks

### Adding a New Search Source

```typescript
// 1. Create new service file
// src/services/newsource.ts
export async function searchNewSource(
  query: string,
  options: SearchOptions
): Promise<SearchResult[]> {
  // Implementation
}

// 2. Update search to merge sources
const [austliiResults, newResults] = await Promise.all([
  searchAustLii(query, options),
  searchNewSource(query, options),
]);

// 3. Deduplicate by citation
const seen = new Map<string, SearchResult>();
for (const r of [...austliiResults, ...newResults]) {
  const key = r.neutralCitation ?? r.url;
  if (!seen.has(key)) seen.set(key, r);
}
const merged = [...seen.values()];

// 4. Add tests
it("should merge results from multiple sources", async () => {
  // Test implementation
});
```

### Improving Text Extraction

```typescript
// When adding new structural preservation:
function extractTextFromHtml(html: string): string {
  const $ = cheerio.load(html);

  // Preserve paragraph numbers
  $('[class*="para"]').each((_, el) => {
    const paraNum = $(el).attr('data-para-num');
    if (paraNum) {
      $(el).prepend(`[${paraNum}] `);
    }
  });

  // Extract preserving structure
  return $('body').text();
}
```

### Adding Search Parameters

**Example: The `sortBy` parameter (already implemented)**

```typescript
// 1. Update SearchOptions interface in src/services/austlii.ts
export interface SearchOptions {
  jurisdiction?: "cth" | "vic" | "nsw" | "qld" | "sa" | "wa" | "tas" | "nt" | "act" | "federal" | "nz" | "other";
  limit?: number;
  type: "case" | "legislation";
  sortBy?: "relevance" | "date" | "auto"; // ✅ IMPLEMENTED
  method?: SearchMethod;
  offset?: number;
}

// 2. Update Zod schema in src/index.ts
const sortByEnum = z.enum(["relevance", "date", "auto"]).default("auto");
const searchCasesShape = {
  query: z.string().min(1),
  jurisdiction: jurisdictionEnum.optional(),
  limit: z.number().int().min(1).max(50).optional(),
  sortBy: sortByEnum.optional(), // ✅ IMPLEMENTED
};

// 3. Implement smart detection in src/services/austlii.ts
const sortMode = determineSortMode(query, options);
if (sortMode === "relevance") {
  searchUrl.searchParams.set("view", "relevance");
} else {
  searchUrl.searchParams.set("view", "date");
}

// 4. Add post-processing for better results
if (sortMode === "relevance" && isCaseNameQuery(query)) {
  finalResults = boostTitleMatches(results, query);
}
```

## Known Issues & Workarounds

### ~~Issue: Search returns citing cases, not target case~~ ✅ FIXED
**Solution**: Implemented intelligent sorting with auto-detection and title matching

### Issue: Page numbers lost in extraction
**Workaround**: Use paragraph numbers for pinpoints
**Fix planned**: Parse page markers from reported judgement HTML

### ~~Issue: No deduplication across sources~~ ✅ FIXED
**Solution**: `enrichWithSourceLinks()` adds removed.invalid lookup URLs to AustLII results; removed.invalid search is a placeholder pending API access

## Resources

- **AustLII Search Help**: <https://www.austlii.edu.au/austlii/help/search.html>
- **MCP Specification**: <https://modelcontextprotocol.io/>
- **Project Roadmap**: [docs/ROADMAP.md](docs/ROADMAP.md)
- **Architecture overview**: [docs/architecture.md](docs/architecture.md)
- **Test Coverage**: Run `npm test` to see real-world scenarios

## Critical Reminders

⚠️ **NEVER commit without building**: Run `npm run build` before committing
⚠️ **NEVER skip tests**: All tests must pass before pushing
⚠️ **ALWAYS preserve paragraph numbers**: They're critical for citations
⚠️ **NEVER include journal articles**: Primary sources only

## Getting Help

- Check `docs/ROADMAP.md` for planned features
- Review existing issues on GitHub
- Run tests to understand expected behaviour
- Check test scenarios for usage examples

---

**Remember**: This is a legal research tool. Accuracy and authority of sources are paramount. When in doubt, prioritise returning the most authoritative version of a judgement over returning more results.
