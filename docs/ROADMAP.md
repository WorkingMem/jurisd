# Feature Development Roadmap

## Current State Analysis

### What Works Well ✅

- Fetches recent case law from AustLII
- Filters out journal articles (primary sources only)
- Extracts neutral citations and jurisdictions
- Preserves paragraph numbers in `[N]` format (402 instances found in test)
- Handles HTML and PDF documents

### Current Limitations 🔴

#### 1. **Search Quality Issues**

- **Problem**: Searching "Donoghue v Stevenson" returns recent 2025 cases that merely cite it, NOT the actual 1932 case
- **Root cause**: Sorting by date prioritises recent cases over relevance
- **Impact**: Users can't find the specific case they're looking for

#### 2. **Limited Sources**

- **Current**: Only searches AustLII
- **Missing**: additional reported-judgment sources, other authoritative sources
- **Impact**: May miss best/most authoritative version of judgments

#### 3. **Paragraph Number Preservation**

- **Current**: Text extraction strips HTML structure
- **Found**: `[N]` format markers ARE preserved (402 instances)
- **Issue**: Page numbers from reported judgments are lost
- **Impact**: Can't generate accurate pinpoints for reported citations

#### 4. **No Ranking/Relevance**

- **Problem**: No way to prioritise authoritative sources
- **Missing**: Reported vs unreported distinction, court hierarchy weighting

## Proposed Solutions

### Phase 1: Fix Search Relevance (HIGH PRIORITY)

**Goal**: Return the ACTUAL case being searched for, not just cases that cite it

**Implementation**:

1. **Add search mode parameter**: `relevance` vs `date` sorting
2. **Smart query detection**:
   - If query looks like case name (e.g. "X v Y"), use relevance
   - If query is topic (e.g. "negligence"), use date for recency
3. **Title matching boost**: Prioritise exact title matches
4. **Citation matching**: Parse citations from query and match

**Code changes**:

```typescript
interface SearchOptions {
  jurisdiction?: "cth" | "vic" | "federal" | "other";
  limit?: number;
  type: "case" | "legislation";
  sortBy?: "relevance" | "date" | "auto"; // NEW
}
```

### Phase 2: Multi-Source Integration (MEDIUM PRIORITY)

**Goal**: Search multiple authoritative sources and return best results

**Sources to integrate**:

1. **Reported-judgment sources** - Superior reported judgments with page numbers
2. **AustLII** - Comprehensive unreported coverage (current)

**Implementation approach**:

```typescript
// Parallel search across sources
const [austliiResults, upstreamResults] = await Promise.all([
  searchAustLii(query, options),
  searchUpstream(query, options), // NEW
]);

// Merge and deduplicate by citation
const merged = deduplicateResults([...austliiResults, ...upstreamResults]);

// Rank by authority: Reported > Unreported, Higher court > Lower court
const ranked = rankByAuthority(merged);
```

**Challenges**:

- Some sources may require authentication/API key
- Need to handle different HTML structures per source
- Deduplication logic must match same case across sources

### Phase 3: Enhanced Paragraph/Page Preservation (HIGH PRIORITY)

**Goal**: Preserve both paragraph numbers AND page numbers for accurate pinpoint citations

**Current state**:

- `[N]` paragraph markers: ✅ Preserved (402 found)
- Page numbers: ❌ Lost in text extraction

**Implementation**:

1. **Improve HTML parsing** to preserve structural markers:

   ```typescript
   // Keep paragraph markers
   <p class="Judg-Para-1">[1]</p> → "[1]"

   // Extract page markers (when present in reported versions)
   <span class="page-num">123</span> → "[Page 123]"
   ```

2. **Return structured content**:

   ```typescript
   interface EnhancedFetchResponse extends FetchResponse {
     paragraphs?: Array<{
       number: number;
       text: string;
       pageNumber?: number;
     }>;
   }
   ```

3. **Pinpoint generation helper**:
   ```typescript
   function generatePinpoint(
     text: string,
     searchPhrase: string,
   ): { paragraph?: number; page?: number } {
     // Find paragraph/page containing phrase
   }
   ```

### Phase 4: Intelligent Result Ranking (MEDIUM PRIORITY)

**Goal**: Return best/most authoritative version of each case

**Ranking criteria** (in order):

1. **Reported vs unreported**: Reported judgments rank higher
2. **Court hierarchy**: HCA > Full Court > Single judge
3. **Completeness**: Judgments with page numbers > without
4. **Recency**: For topic searches, prefer recent
5. **Relevance**: Title/citation exact match > partial match

**Implementation**:

```typescript
function calculateAuthorityScore(result: SearchResult): number {
  let score = 0;

  // Reported judgment
  if (result.citation && !result.neutralCitation) score += 100;

  // Court hierarchy
  if (result.url.includes("/HCA/")) score += 50;
  else if (result.url.includes("/FCA/")) score += 30;
  // ... etc

  // Has page numbers
  if (result.metadata?.hasPageNumbers) score += 20;

  return score;
}
```

## Implementation Status

### ✅ Phase 1: Search Relevance (COMPLETED)

**Implemented features:**

1. ✅ Smart query detection: Auto-detects case names ("X v Y", "Re X", citations) vs topic searches
2. ✅ `sortBy` parameter: "auto" (default), "relevance", or "date" modes
3. ✅ Title matching boost: Prioritizes exact case name matches in results
4. ✅ Auto mode intelligence:
   - Case name queries → relevance sorting to find specific cases
   - Topic queries → date sorting for recent jurisprudence
5. ✅ Comprehensive test suite: 7 new tests covering all sorting scenarios

**What was fixed:**

- ❌ **OLD**: Searching "Donoghue v Stevenson" returned 2025 cases citing it
- ✅ **NEW**: Search returns the actual case being searched for

**Technical details:**

- Pattern detection for "X v Y", "Re X", citations, and quoted queries
- Title scoring algorithm with party name matching
- Configurable sorting with sensible defaults

## Implementation Priority

### Must Have (Next Sprint)

1. ✅ ~~Fix search relevance for case name queries~~ (COMPLETED)
2. ✅ ~~Preserve paragraph numbers properly~~ (already working)
3. ✅ ~~Add search mode parameter (relevance/date/auto)~~ (COMPLETED)

### ✅ Phase 2A: Reported Citations (COMPLETED)

**Implemented features:**

1. ✅ Reported citation extraction from AustLII results
   - Extracts citations like `(2024) 350 ALR 123`, `(1992) 175 CLR 1`
   - Supports common law report patterns (CLR, ALR, ALJR, etc.)
   - Automatically extracted from titles and summaries
2. ✅ Enhanced SearchResult interface
   - Added `reportedCitation` field
3. ✅ New test coverage (4 additional tests)

**What this enables:**

- Users can now see both neutral and reported citations
- More complete citation information for legal research

**Technical implementation:**

- `extractReportedCitation()` function with regex patterns
- Updated test suite with 18 total scenarios

### ✅ Phase 3: Paragraph Block Extraction and Pinpoint Citations (COMPLETED)

**Implemented features:**

1. ✅ `ParagraphBlock` interface with `number`, `text`, and optional `pageNumber`
2. ✅ `paragraphs` field on `FetchResponse` - populated from `[N]` markers in AustLII HTML
3. ✅ `generate_pinpoint` MCP tool: finds paragraph by number or phrase, returns `at [N]` string
4. ✅ Full citation composition: `"[2022] FedCFamC2F 786 at [23]"`

### ✅ Phase 4: Authority-Based Result Ranking (COMPLETED)

**Implemented features:**

1. ✅ `calculateAuthorityScore()` with court hierarchy scoring (HCA=100, FCAFC=80, FCA=60, state SC=30, etc.)
2. ✅ Reported citation bonus (+10 points)
3. ✅ Secondary sort by authority score applied to case-name queries

### ✅ Phase 5: AGLC4 Citation Service (COMPLETED)

**Implemented features:**

1. ✅ `parseCitation()` - extracts neutral and reported citations from text
2. ✅ `formatAGLC4()` - formats citations per AGLC4 rules
3. ✅ `validateCitation()` - HEAD-checks citation against AustLII
4. ✅ `generatePinpoint()` - finds paragraph by number or phrase
5. ✅ Extended `NEUTRAL_CITATION_PATTERN` to handle mixed-case court codes (e.g. FedCFamC2F)
6. ✅ `REPORTERS` registry and `COURT_TO_AUSTLII_PATH` map added to constants

### ✅ Phase 6: Security Hardening (COMPLETED)

**Implemented features:**

1. ✅ `assertFetchableUrl()` - SSRF protection: HTTPS-only, allowlisted hosts (austlii.edu.au)
2. ✅ Cookie sanitisation: printable ASCII validation, newline injection rejection
3. ✅ Token bucket rate limiter: 10 req/min AustLII
4. ✅ Config DRY: all hardcoded constants removed, sourced from `config.ts`

### ✅ Phase 7: New MCP Tools (COMPLETED)

**Four new tools registered:**

1. ✅ `format_citation` - formats AGLC4 citations with neutral, reported, and pinpoint components
2. ✅ `validate_citation` - validates neutral citations against AustLII and returns canonical URL
3. ✅ `generate_pinpoint` - fetches a judgment and generates a pinpoint citation reference
4. ✅ `search_by_citation` - resolves a citation to a direct URL or falls back to text search

### Should Have (Future)

1. 🔶 Upstream Source integration
2. 🔶 Related cases and legislation suggestions

## 2026-04 Roadmap Audit (Feature-by-Feature)

| Item                                                            | Status                             | Evidence in code/tests                                                                                                                                                                                                                                 | Merge needed |
| --------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| Phase 1: Search relevance (`auto`/`relevance`/`date`)           | ✅ Delivered                       | `src/services/austlii.ts` (`isCaseNameQuery`, `determineSortMode`, `boostTitleMatches`); tests in `src/test/unit/austlii.test.ts`, live usage in `src/test/scenarios.test.ts`                                                                          | No           |
| Phase 2: Search results + dedupe                                | ✅ Delivered                       | `search_cases` tool in `src/index.ts`; deterministic merge tests in `src/test/unit/search-merge.test.ts`                                                                                                                                               | No           |
| Phase 3: Paragraph block extraction + pinpoint                  | ✅ Delivered (paragraph pinpoints) | `ParagraphBlock` + extraction in `src/services/fetcher.ts`; pinpoint generation in `src/services/citation.ts`; tests in `src/test/unit/fetcher.test.ts`, `src/test/unit/citation.test.ts`                                                              | No           |
| Phase 4: Authority ranking                                      | ✅ Delivered                       | `calculateAuthorityScore` in `src/services/austlii.ts`; tests in `src/test/unit/austlii.test.ts`                                                                                                                                                       | No           |
| Phase 5: AGLC4 citation service                                 | ✅ Delivered                       | `src/services/citation.ts`; tests in `src/test/unit/citation.test.ts`                                                                                                                                                                                  | No           |
| Phase 6: Security hardening (SSRF, cookie hygiene, rate limits) | ✅ Delivered                       | `src/utils/url-guard.ts`, `src/utils/rate-limiter.ts`, fetch/search sanitisation in services; tests in `src/test/unit/url-guard.test.ts`, `src/test/unit/rate-limiter.test.ts`, `src/test/unit/fetcher.test.ts`, `src/test/unit/source-search.test.ts` | No           |
| Phase 7: New MCP tools                                          | ✅ Delivered                       | Tool registrations in `src/index.ts` (`format_citation`, `validate_citation`, `generate_pinpoint`, `search_by_citation`)                                                                                                                               | No           |

### RHIL testability blockers and direct remedies

1. **Upstream Source official integration** (RHIL)
   - **Why not fully testable now**: Requires vendor-side API access/contract not available in this repository.
   - **Direct remedy**: Obtain Upstream-provided API credentials + schema + rate-limit policy, then add contract tests against a sandbox endpoint and gated CI secrets.

## Testing Requirements

Each phase must include:

1. **Unit tests** for new parsing/ranking logic
2. **Integration tests** with real judgments
3. **Comparison tests** - verify improvements over current state
4. **Performance tests** - ensure multi-source doesn't timeout

## Success Metrics

1. **Search accuracy**: "Donoghue v Stevenson" returns the 1932 case, not 2025 cases
2. **Pinpoint accuracy**: Can generate `[2025] HCA 26 at [42]` style citations
3. **Source coverage**: Returns reported judgment when available
4. **Response time**: < 5 seconds for multi-source search
