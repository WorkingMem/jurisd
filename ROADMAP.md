# jurisd Roadmap

## Current State

| Tool                               | Source                     | Status                                                          |
| ---------------------------------- | -------------------------- | --------------------------------------------------------------- |
| `search_cases`                     | AustLII                    | Working                                                         |
| `search_legislation`               | AustLII                    | Working                                                         |
| `fetch_document_text`              | AustLII (HTML, PDF)        | Working                                                         |
| `resolve_jade_article`             | jade.io (title metadata)   | Working                                                         |
| `jade_citation_lookup`             | jade.io (URL construction) | Working                                                         |
| `fetch_document_text`              | jade.io                    | Implemented via GWT-RPC when `JADE_SESSION_COOKIE` is available |
| Tavily-backed search/extract/fetch | Tavily + public web        | Planned investigation                                           |

---

## Product Boundary

`jurisd` is an on-demand legal citation resolution and extraction server.

In scope:

- resolve Australian legal citations to authoritative web sources;
- search cases and legislation by citation, title, party, Act name, section, jurisdiction, and date;
- fetch and extract useful text from judgments, legislation, and citation pages;
- return AGLC4-ready citation metadata and pinpoint-friendly excerpts;
- compare source coverage across AustLII, jade.io, and Tavily-backed public-web extraction.

Out of scope:

- corpus indexing;
- issue mapping;
- affidavit drafting workflows;
- large-scale message classification.

---

## Tavily-backed AustLII enrichment

### Goal

Use Tavily search/extract/fetch capabilities to make AustLII discovery and extraction more resilient without turning `jurisd` into a corpus/RAG system.

### Planned capabilities

- Use Tavily search to find likely AustLII, official legislation, and jade.io pages when native AustLII search returns weak title matches.
- Use Tavily extract/fetch as a fallback when direct AustLII fetches time out or return unusable content.
- Prefer official sources for legislation, including state legislation sites, when AustLII consolidated Act pages return `410 Gone` or stale content.
- Return source provenance with every result: direct AustLII, official legislation site, jade.io, or Tavily-discovered page.
- Keep extraction request-scoped and stateless. Do not store or embed documents.

### Candidate tools / parameters

- Add `source_strategy?: "direct" | "tavily" | "auto"` to search/fetch tools.
- Add `resolve_citation(citation, jurisdiction?, source_strategy?)` for one-shot citation resolution.
- Add `extract_citation_context(url, citation?, pinpoint?)` for targeted extraction from a resolved page.
- Add `fetch_legislation_section(act, section, jurisdiction?, as_at?, source_strategy?)` for section-level extraction.

---

## Legislation retrieval reliability

### Problem

AustLII Victorian consolidated legislation paths can return `410 Gone`, and title searches can return cross-references before the principal Act.

### Planned capabilities

- Add official Victorian legislation fallback for consolidated Acts when AustLII fails.
- Add version-aware fetch inputs (`as_at`, `version`, jurisdiction) where official sources expose them.
- Add section-level legislation extraction so agents can request one section instead of an entire Act.
- Improve `search_legislation` ranking so exact principal Act title matches outrank cross-references and amendment instruments.
- Preserve AGLC4-ready metadata: Act title, jurisdiction, version/as-at date, section, and source URL.

---

## Jade.io versus Tavily investigation

### Question

Does jade.io still provide unique value now that Tavily can search and extract public legal pages, or can Tavily cover most citation resolution and extraction needs?

### Current hypothesis

- Tavily may replace or augment Jade for broad web discovery and public-page extraction.
- Jade may still provide unique value for structured metadata, reported citations, and cited-by/citator references.
- If Tavily can reliably discover cited-by references or equivalent citation networks, the roadmap should consider reducing the Jade-specific surface.

### Investigation tasks

- Compare Tavily search results against `resolve_jade_article` for known neutral and reported citations.
- Compare Tavily extraction against Jade GWT-RPC full-text extraction for a small set of judgments.
- Test whether Tavily can discover cited-by references for cases where Jade's citator has known results.
- Decide whether Jade remains a primary source, a fallback source, or only a citator provider.

---

## jade.io Full-Text Fetching

### Why it doesn't work today

jade.io (BarNet Jade) is a GWT (Google Web Toolkit) single-page application. The initial HTTP
response for any `https://jade.io/article/<id>` URL is a ~12KB JavaScript bootstrap shell. The
actual judgment text is loaded client-side by the GWT runtime via subsequent XHR requests. A
simple HTTP fetch + HTML extraction pipeline (the current approach for AustLII) returns empty
content for jade.io URLs. As of this writing, `fetch_document_text` throws an explicit error for
jade.io URLs rather than silently returning empty content.

### Why jade.io matters

- AustLII carries most published Australian judgments, but jade.io provides:
  - Reported citations (e.g. `(2024) 98 ALJR 123`) alongside neutral citations
  - Earlier and more complete coverage of some state courts
  - Annotations, catchwords, and judgment summaries not on AustLII
  - Better family law coverage including some FCFCA unreported decisions

---

## Planned Investigation: jade.io API Reverse Engineering

Before committing to a heavy headless-browser dependency, investigate whether jade.io's
backend XHR API can be called directly with session credentials.

### Phase 1 — Network Traffic Analysis

**Goal:** Identify the XHR endpoints the GWT app uses to load judgment text.

Tasks:

- [x] Open Chrome DevTools Network tab on an authenticated jade.io session
- [x] Navigate to a known judgment (`jade.io/article/67401`)
- [x] Filter for XHR/Fetch requests and capture all calls after initial page load
- [x] Identify endpoints that return judgment content
- [x] Document URL patterns, authentication mechanism, and response schema
- [ ] Inspect `jadeService.do` POST body and response for article content call (needs Proxyman)

**Findings (2026-03-02):**

All jade.io API traffic uses **GWT-RPC** wire format (`//OK[integer-array, ..., string-table]`).
There is no REST or JSON API surface accessible without GWT-RPC deserialization.

Endpoints observed loading `jade.io/article/67401`:

| Endpoint                                                   | Method  | Purpose                                                     |
| ---------------------------------------------------------- | ------- | ----------------------------------------------------------- |
| `jadeService.do`                                           | POST ×6 | Main GWT-RPC service (likely includes article content load) |
| `tranche2.do?ds:JadeModelAllUsersInitial,0,0,{userId},,,0` | GET     | User session state (DomainModel init)                       |
| `tranche2.do?ds:JadeModelJournals,0,0,{userId},,,0`        | GET     | Journal metadata for UI                                     |

The integer `127351` in `tranche2.do` URLs is the authenticated **user ID**, not the article ID.

Additional findings:

- **Cookies rotate on every response** — `IID` and `alcsessionid` are refreshed via `Set-Cookie`
  on each reply. Any direct API client must maintain a cookie jar and track rotations.
- Auth cookies are `HttpOnly` — not readable via `document.cookie`, but sent automatically by
  the browser with each request.
- Cookie extraction from Chrome: `browser_cookie3` can read HttpOnly cookies from the Chrome
  profile on disk (macOS Keychain decryption included).

Next: use Proxyman to capture the `jadeService.do` POST body and response for the article content
call to determine the GWT-RPC method name and argument structure.

Key things still to determine:

- Which of the 6 `jadeService.do` calls loads article text, and what is the GWT-RPC method name?
- Is the judgment text in the GWT-RPC response, or is it fetched as a separate static resource?
- Is there pagination or chunking for long judgments?

### Phase 2 — Feasibility Assessment (COMPLETED 2026-03-02)

**Assessment:** Option A (Direct GWT-RPC API) is fully feasible and has been implemented.

#### Option A: Direct GWT-RPC API - IMPLEMENTED

**Initial attempt (Proxyman HAR, 2026-03-02):** Captured `getInitialContent` on
`JadeRemoteService` (strong name `16E3F568878E6841670449E07D95BA3E`). However,
calling this method directly (from Node.js or browser JS) returns HTTP 200 with
empty body. The server appears to require prior session state setup that only
occurs during the full GWT page load sequence.

**Working method (SPA interception, 2026-03-02):** Installed an XHR interceptor
in a live authenticated jade.io session and triggered SPA navigation from the
Jade Browser to capture the actual content-loading sequence. Discovered
`avd2Request` on `ArticleViewRemoteService` - this is the primary method the
GWT app uses to load article content.

**Endpoint:** `POST https://jade.io/jadeService.do`

**Request headers:**

```
Content-Type: text/x-gwt-rpc; charset=UTF-8
X-GWT-Module-Base: https://jade.io/au.com.barnet.jade.JadeClient/
X-GWT-Permutation: 0BCBB10F3C94380A7BB607710B95A8EF
Origin: https://jade.io
Referer: https://jade.io/article/{articleId}
Cookie: {session cookie}
```

**Request body** (`avd2Request` method, article 1182103):

```
7|0|10|https://jade.io/au.com.barnet.jade.JadeClient/|E2F710F48F8237D9E1397729B9933A69|au.com.barnet.jade.cs.remote.ArticleViewRemoteService|avd2Request|au.com.barnet.jade.cs.csobjects.avd.Avd2Request/2068227305|au.com.barnet.jade.cs.persistent.Jrl/728826604|au.com.barnet.jade.cs.persistent.Article|java.util.ArrayList/4159755760|au.com.barnet.jade.cs.csobjects.avd.PhraseFrequencyParams/1915696367|cc.alcina.framework.common.client.util.IntPair/1982199244|1|2|3|4|1|5|5|A|A|0|6|EgmX|A|0|A|A|7|0|0|0|8|0|0|9|0|10|3|500|A|8|0|
```

Where `EgmX` is 1182103 encoded using GWT's custom base-64 charset.

**Strong names:**

- `E2F710F48F8237D9E1397729B9933A69` - ArticleViewRemoteService (avd2Request, getCitedPreview)
- `16E3F568878E6841670449E07D95BA3E` - JadeRemoteService (getArticleStructuredMetadata)

**Response format:**

```
//OK[integer_refs..., ["string_table_entry_1", ..., "HTML_CONTENT"], 4, 7]
```

Not strict JSON - uses JavaScript `"+"` string concatenation for long strings.
After removing `"+"` markers, parseable with `JSON.parse`. The HTML content is the
longest string in the nested string table array at `parsed[parsed.length - 3]`.
Unicode escape sequences (`\u003C` etc.) are decoded by `JSON.parse` automatically.

**Three calls fired per article navigation:**

1. `avd2Request` (ArticleViewRemoteService) - returns full HTML (25KB-738KB)
2. `getArticleStructuredMetadata` (JadeRemoteService) - returns schema.org JSON (228B-2KB)
3. `loadTranches` (JadeRemoteService) - returns DomainModel data (34KB-967KB)

**Additional method:** `getArticleStructuredMetadata` returns schema.org JSON
with case name and neutral citation (228 bytes, simpler than avd2Request).
Body template: `7|0|5|...|getArticleStructuredMetadata|J|1|2|3|4|1|5|{ENCODED_ID}|`

**Dead end: getInitialContent** - captured from Proxyman HAR but returns empty
body when called directly. Likely requires server-side state from the 49
`jadeService.do` calls that occur during full page load. Not usable for our
purposes.

#### Options B and C - Not implemented

Option B (Playwright headless browser): Not needed given Option A works.
Option C (Chrome MCP bridge): Useful for investigation but too fragile for production.

### Phase 3 - Implementation (COMPLETED 2026-03-02)

- [x] Implement `encodeGwtInt()` in `src/services/jade-gwt.ts`
- [x] Implement `buildGetInitialContentRequest()` in `src/services/jade-gwt.ts` (kept for reference)
- [x] Implement `buildAvd2Request()` in `src/services/jade-gwt.ts` (primary method)
- [x] Implement `buildGetMetadataRequest()` in `src/services/jade-gwt.ts`
- [x] Implement `parseGwtRpcResponse()` in `src/services/jade-gwt.ts` (simple format)
- [x] Implement `parseAvd2Response()` in `src/services/jade-gwt.ts` (complex format with string concat)
- [x] Implement `fetchJadeArticleContent()` in `src/services/jade.ts` (uses avd2Request)
- [x] Update `fetchDocumentText` in `src/services/fetcher.ts`: - When `JADE_SESSION_COOKIE` is set: call GWT-RPC API, return full HTML - When not set: throw with `JADE_SESSION_COOKIE` instructions
- [x] Add integration tests in `src/test/jade.test.ts` (skipped in CI and without env var)
- [ ] Update `.env.example` with cookie extraction instructions
- [ ] Document the cookie refresh workflow in README

---

## On-demand citation resolution and extraction improvements

### `resolve_citation` tool

Add a single entry point for citation resolution:

```text
resolve_citation(citation, jurisdiction?, source_strategy?)
```

Expected behaviour:

- parse neutral and reported citations;
- search AustLII, jade.io, and Tavily-backed public sources;
- return ranked candidate sources with citation metadata;
- mark whether the result is a judgment, legislation, article, or secondary source;
- include confidence and source provenance.

### `extract_citation_context` tool

Add targeted extraction for a resolved citation or URL:

```text
extract_citation_context(citation_or_url, pinpoint?, source_strategy?)
```

Expected behaviour:

- fetch the source document on demand;
- extract the relevant paragraph, section, or nearby context;
- return plain text plus source URL and AGLC4 citation metadata;
- avoid storing or indexing the document.

### Cited-by / citator capability

Keep Jade citator support unless investigation proves Tavily can reliably provide equivalent cited-by references.

Candidate future shape:

```text
find_citing_references(citation_or_url, source_strategy?)
```

Source priority is unresolved:

- Jade remains likely useful for explicit citator/cited-by data.
- Tavily may supplement with web-discovered references, but must be tested against known cited-by examples.

---

## Other Planned Improvements

### PDF output format for `fetch_document_text`

Currently requires a two-step workflow (fetch HTML, convert with Chrome headless externally).
A `format: "pdf"` option could shell out to `chromium --headless --print-to-pdf` and return
a base64-encoded PDF or write to a temp path.

### Configurable content selectors

AustLII and jade.io page structure changes occasionally break cheerio selectors. A config
file mapping host patterns to CSS selectors would make this maintainable without code changes.

### Citation format support

Expand `generatePinpoint` to support reported citations (CLR, ALJR, FCR, etc.) in addition
to neutral citations.
