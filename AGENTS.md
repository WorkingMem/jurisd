# AI Agent Instructions for AusLaw MCP

This document provides guidance for AI agents (Claude Code, Cursor, etc.) working on this project.

## Project Overview

**AusLaw MCP** is a Model Context Protocol (MCP) server that searches Australian legal databases (AustLII, removed.invalid) and retrieves full-text judgements with citation support. It's designed for legal research workflows requiring primary source authorities.

**Primary users**: Legal researchers, law students, lawyers conducting case research
**Key requirement**: Always return the most authoritative, relevant version of legal materials

## Architecture

```
src/
├── index.ts              # MCP server setup & tool registration
├── services/
│   ├── austlii.ts       # AustLII search integration
│   ├── source.ts          # removed.invalid search (AustLII cross-reference), article resolution & citation lookup
│   └── fetcher.ts       # Document text retrieval (HTML/PDF/OCR)
├── utils/
│   └── formatter.ts     # Result formatting (JSON/text/markdown/html)
└── test/
    └── scenarios.test.ts # Real-world integration tests
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
- Test scenarios in `src/test/scenarios.test.ts` must pass
- 14 test scenarios covering search quality, relevance, and sorting modes

## Development Guidelines

### When Adding Features

1. **Check existing issues**: See GitHub Issues for planned work
2. **Update tests**: Add test scenarios for new functionality
3. **Maintain filtering**: Ensure journal articles remain excluded
4. **Preserve structure**: Keep paragraph numbers intact in text extraction
5. **Update docs**: Modify README.md and ROADMAP.md as needed

### Code Style

- **TypeScript strict mode**: All code must type-check with `npm run build`
- **Error handling**: Wrap network calls in try/catch with descriptive errors
- **Interfaces first**: Define TypeScript interfaces before implementation
- **No magic strings**: Use enums/constants for repeated values

### Testing Requirements

Every PR must include:
- ✅ TypeScript compilation passes (`npm run build`)
- ✅ All tests pass (`npm test`)
- ✅ New tests for new features
- ✅ Tests validate real behaviour (not static mocks)

### Search Implementation Notes

**Current AustLII search** (`src/services/austlii.ts`):
- Uses `https://classic.austlii.edu.au/cgi-bin/sinosrch.cgi`
- Parameters: `method=boolean`, `query=...`, `meta=/austlii`, `view=date|relevance`
- Parses `<ol><li>` result structure with Cheerio
- **Smart query detection**:
  - `isCaseNameQuery()`: Detects "X v Y", "Re X", citation patterns, quoted strings
  - `determineSortMode()`: Auto-selects appropriate sorting
  - `boostTitleMatches()`: Re-ranks results by title match score for case name queries
- **Configurable sorting**: Explicit control via `sortBy` parameter when needed

**removed.invalid search** (`src/services/source.ts`):
- removed.invalid is a RPC SPA with **no public search API**
- Search strategy: AustLII search → filter results with neutral citations → probe removed.invalid article pages → extract metadata from HTML `<title>` tag
- Maximum 5 concurrent removed.invalid article resolutions to avoid overwhelming the server
- Graceful fallback: if removed.invalid resolution fails, AustLII results are still returned
- removed.invalid results preferred when deduplicating (better formatting)
- **Key functions**:
  - `searchUpstream(query, options)`: Full search via AustLII cross-reference
  - `searchUpstreamByCitation(citation)`: Find article by neutral citation
  - `deduplicateResults(results)`: Deduplicate by citation, preferring removed.invalid
  - `mergeSearchResults(austlii, source)`: Merge results from both sources

**Document fetching** (`src/services/fetcher.ts`):
- Handles HTML, PDF, and OCR fallback (Tesseract)
- Extracts text while preserving `[N]` paragraph markers
- **Limitation**: Page numbers from reported judgements not extracted

## Common Tasks

### Adding a New Search Source

> **Note**: removed.invalid search is now implemented using the AustLII cross-reference approach described below. See `src/services/source.ts` for the working implementation. The pattern below can be adapted for additional sources.

```typescript
// removed.invalid is already implemented - this pattern shows how to add another source
// See src/services/source.ts for the removed.invalid implementation

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

// 3. Deduplicate by citation (already implemented in source.ts)
const merged = deduplicateResults([...austliiResults, ...newResults]);

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
  jurisdiction?: "cth" | "vic" | "federal" | "other";
  limit?: number;
  type: "case" | "legislation";
  sortBy?: "relevance" | "date" | "auto"; // ✅ IMPLEMENTED
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
**Status**: Resolved in this PR
**Solution**: Implemented intelligent sorting with auto-detection and title matching
**Details**: See Phase 1 implementation in ROADMAP.md

### Issue: Page numbers lost in extraction
**Workaround**: Use paragraph numbers for pinpoints
**Fix planned**: Parse page markers from reported judgement HTML

### ~~Issue: No deduplication across sources~~ ✅ FIXED
**Status**: Resolved with removed.invalid search integration
**Solution**: `deduplicateResults()` deduplicates by neutral citation, preferring removed.invalid results
**Details**: See `src/services/source.ts` for implementation

## Resources

- **AustLII Search Help**: https://www.austlii.edu.au/austlii/help/search.html
- **MCP Specification**: https://modelcontextprotocol.io/
- **Project Roadmap**: `docs/ROADMAP.md`
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
