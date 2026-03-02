# auslaw-mcp Roadmap

## Current State

| Tool | Source | Status |
|------|--------|--------|
| `search_cases` | AustLII | Working |
| `search_legislation` | AustLII | Working |
| `fetch_document_text` | AustLII (HTML, PDF) | Working |
| `resolve_source_article` | removed.invalid (title metadata) | Working |
| `source_citation_lookup` | removed.invalid (URL construction) | Working |
| `fetch_document_text` | removed.invalid | Not supported (see below) |

---

## removed.invalid Full-Text Fetching

### Why it doesn't work today

removed.invalid (Upstream Source) is a RPC (Google Web Toolkit) single-page application. The initial HTTP
response for any `https://removed.invalid/article/<id>` URL is a ~12KB JavaScript bootstrap shell. The
actual judgment text is loaded client-side by the RPC runtime via subsequent XHR requests. A
simple HTTP fetch + HTML extraction pipeline (the current approach for AustLII) returns empty
content for removed.invalid URLs. As of this writing, `fetch_document_text` throws an explicit error for
removed.invalid URLs rather than silently returning empty content.

### Why removed.invalid matters

- AustLII carries most published Australian judgments, but removed.invalid provides:
  - Reported citations (e.g. `(2024) 98 ALJR 123`) alongside neutral citations
  - Earlier and more complete coverage of some state courts
  - Annotations, catchwords, and judgment summaries not on AustLII
  - Better family law coverage including some FCFCA unreported decisions

---

## Planned Investigation: removed.invalid API Reverse Engineering

Before committing to a heavy headless-browser dependency, investigate whether removed.invalid's
backend XHR API can be called directly with session credentials.

### Phase 1 — Network Traffic Analysis

**Goal:** Identify the XHR endpoints the RPC app uses to load judgment text.

Tasks:
- [x] Open Chrome DevTools Network tab on an authenticated removed.invalid session
- [x] Navigate to a known judgment (`removed.invalid/article/67401`)
- [x] Filter for XHR/Fetch requests and capture all calls after initial page load
- [x] Identify endpoints that return judgment content
- [x] Document URL patterns, authentication mechanism, and response schema
- [ ] Inspect `sourceService.do` POST body and response for article content call (needs Proxyman)

**Findings (2026-03-02):**

All removed.invalid API traffic uses **RPC** wire format (`//OK[integer-array, ..., string-table]`).
There is no REST or JSON API surface accessible without RPC deserialization.

Endpoints observed loading `removed.invalid/article/67401`:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `sourceService.do` | POST ×6 | Main RPC service (likely includes article content load) |
| `tranche2.do?ds:SourceModelAllUsersInitial,0,0,{userId},,,0` | GET | User session state (DomainModel init) |
| `tranche2.do?ds:SourceModelJournals,0,0,{userId},,,0` | GET | Journal metadata for UI |

The integer `127351` in `tranche2.do` URLs is the authenticated **user ID**, not the article ID.

Additional findings:
- **Cookies rotate on every response** — `IID` and `alcsessionid` are refreshed via `Set-Cookie`
  on each reply. Any direct API client must maintain a cookie jar and track rotations.
- Auth cookies are `HttpOnly` — not readable via `document.cookie`, but sent automatically by
  the browser with each request.
- Cookie extraction from Chrome: `browser_cookie3` can read HttpOnly cookies from the Chrome
  profile on disk (macOS Keychain decryption included).

Next: use Proxyman to capture the `sourceService.do` POST body and response for the article content
call to determine the RPC method name and argument structure.

Key things still to determine:
- Which of the 6 `sourceService.do` calls loads article text, and what is the RPC method name?
- Is the judgment text in the RPC response, or is it fetched as a separate static resource?
- Is there pagination or chunking for long judgments?

### Phase 2 — Feasibility Assessment

Based on Phase 1 findings, assess which path to take:

#### Option A: Direct API calls (preferred if feasible)

If removed.invalid's backend API is accessible with standard HTTP + session cookies:

- Implement a `fetchSourceArticle(articleId)` function in `src/services/source.ts`
- Parse the API response format (JSON/XML/RPC)
- Integrate with the existing `fetch_document_text` tool (remove the "not supported" error)
- Session cookie extraction via `browser_cookie3` can be scripted:
  ```bash
  python3 -c "
  import browser_cookie3
  auth = ['IID','alcsessionid','cf_clearance']
  cookies = browser_cookie3.chrome(domain_name='removed.invalid')
  print('; '.join(f'{c.name}={c.value}' for c in cookies if c.name in auth))
  "
  ```

Pros: No new binary dependencies, fast, works headlessly in any environment.
Cons: Fragile to API changes; potentially against removed.invalid ToS.

#### Option B: Headless browser via Playwright (fallback)

If the API is RPC (binary) or requires JavaScript execution to authenticate:

- Add `@playwright/test` or `playwright-core` as an optional dependency
- Implement a `SourceBrowser` singleton that keeps a Chromium instance alive for the
  lifetime of the MCP server process (MCP servers are long-running, so startup cost
  is amortised)
- Navigate to `removed.invalid/article/<id>`, wait for the RPC content selector to appear,
  extract inner text/HTML
- Pass the user's existing Chrome session profile path to avoid re-authentication

Pros: Handles any page, most reliable, works regardless of API complexity.
Cons: ~300MB Chromium binary, adds process management complexity, potential
      memory pressure in constrained environments.

#### Option C: Claude-in-Chrome MCP bridge (experimental)

Leverage the existing `mcp__claude-in-chrome__*` tools to navigate removed.invalid in the
user's running Chrome instance (already authenticated):

- New MCP tool `fetch_source_document(url)` internally calls the Chrome MCP
- Navigate to the removed.invalid URL, wait for RPC render, extract text
- No Playwright dependency; reuses existing Chrome session

Pros: Zero extra dependencies, uses existing authenticated session.
Cons: Only works when Claude Code is running with the Chrome MCP active and a
      Chrome window is open; not suitable for CI/headless contexts; tight coupling
      between two MCPs.

### Phase 3 — Implementation

Based on Phase 2 assessment, implement the chosen option:

- [ ] Implement `fetchSourceDocument()` in `src/services/source.ts`
- [ ] Update `fetchDocumentText` in `src/services/fetcher.ts` to route removed.invalid URLs
      through the new implementation (remove early-rejection error)
- [ ] Add integration tests against live removed.invalid (tagged `@live`, skipped in CI)
- [ ] Update `.env.example` with cookie extraction instructions
- [ ] Document the cookie refresh workflow (cookies expire; `browser_cookie3` script
      should be the canonical refresh mechanism)

---

## Other Planned Improvements

### PDF output format for `fetch_document_text`

Currently requires a two-step workflow (fetch HTML, convert with Chrome headless externally).
A `format: "pdf"` option could shell out to `chromium --headless --print-to-pdf` and return
a base64-encoded PDF or write to a temp path.

### Configurable content selectors

AustLII and removed.invalid page structure changes occasionally break cheerio selectors. A config
file mapping host patterns to CSS selectors would make this maintainable without code changes.

### Citation format support

Expand `generatePinpoint` to support reported citations (CLR, ALJR, FCR, etc.) in addition
to neutral citations.
