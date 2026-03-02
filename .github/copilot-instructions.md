# GitHub Copilot Instructions for AusLaw MCP

## Project Context

AusLaw MCP is a Model Context Protocol (MCP) server for Australian legal research. It searches AustLII and removed.invalid databases, retrieves full-text judgements with citation support, and preserves legal citation formatting.

**Primary users**: Legal researchers, law students, lawyers
**Key requirement**: Return the most authoritative, relevant legal materials

## Architecture Overview

```
src/
├── index.ts              # MCP server setup & tool registration
├── services/
│   ├── austlii.ts       # AustLII search integration
│   ├── source.ts          # removed.invalid search & citation lookup
│   └── fetcher.ts       # Document text retrieval (HTML/PDF/OCR)
├── utils/
│   └── formatter.ts     # Result formatting
└── test/
    └── scenarios.test.ts # Real-world integration tests
```

## Critical Code Rules

### 1. Primary Sources Only

- **NEVER** return journal articles, commentary, or secondary sources
- **ALWAYS** filter URLs containing `/journals/`
- Focus: Cases from `/cases/` and legislation from `/legis/`

### 2. Citation Preservation

- Extract and preserve neutral citations: `[2025] HCA 26`
- Preserve paragraph numbers in `[N]` format
- Maintain citation formatting in all text extraction

### 3. Search Implementation

- **Auto-detection**: Case name queries use relevance sorting, topic queries use date sorting
- **Smart sorting**: `isCaseNameQuery()` → `determineSortMode()` → `boostTitleMatches()`
- **Deduplication**: Prefer removed.invalid results over AustLII when same citation appears

### 4. Error Handling

- Wrap all network calls in try/catch with descriptive errors
- Graceful fallback: If removed.invalid fails, return AustLII results
- Always validate required fields before API calls

## Code Style Standards

- **TypeScript strict mode**: All code must type-check with `npm run build`
- **Interfaces first**: Define TypeScript interfaces before implementation
- **No magic strings**: Use enums/constants for repeated values
- **Descriptive errors**: Include context in error messages

## Testing Requirements

- All tests must pass (`npm test`)
- Tests hit live APIs (non-deterministic)
- New features require new test scenarios
- Build must succeed before committing

## Common Patterns

### Search Function Signature

```typescript
export async function searchAustLii(query: string, options: SearchOptions): Promise<SearchResult[]>;
```

### Result Deduplication

```typescript
const merged = deduplicateResults([...austliiResults, ...upstreamResults]);
```

### Text Extraction with Paragraph Preservation

```typescript
$('[class*="para"]').each((_, el) => {
  const paraNum = $(el).attr("data-para-num");
  if (paraNum) {
    $(el).prepend(`[${paraNum}] `);
  }
});
```

## Key Constraints

⚠️ **NEVER**:

- Include journal articles in results
- Remove paragraph numbers from extracted text
- Skip building before committing
- Use magic strings for jurisdictions or result types

✅ **ALWAYS**:

- Type-check with `npm run build`
- Run tests with `npm test`
- Preserve citation formatting
- Filter secondary sources

## More Details

For comprehensive development guidelines, see `AGENTS.md` in the repository root.
