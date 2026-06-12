# jurisd - Claude Code Project Instructions

## Project Overview

MCP server for Australian/NZ legal research. Searches AustLII and jade.io, retrieves full-text judgments, formats AGLC4 citations.

## Build & Test

```bash
npm run build          # TypeScript compile
npm test               # All tests (unit + integration + perf; integration hits live services)
npx vitest run src/test/unit/  # Unit tests only (fast, no network)
npm run lint           # ESLint (flat config via eslint.config.mjs)
npm run lint:fix       # Auto-fix lint issues
```

- Always run `npm run build` before pushing (CI runs on push)
- Unit tests must all pass before committing; integration/perf test failures from network timeouts are acceptable
- ESLint uses flat config (`eslint.config.mjs`), NOT legacy `.eslintrc`

## Key Architecture

- `src/index.ts` - MCP server, 18 tool registrations
- `src/services/jade-gwt.ts` - GWT-RPC protocol: `proposeCitables` (search), `avd2Request` (fetch), citator, strong names, GWT encoding
- `src/services/jade.ts` - jade.io integration: `searchJade`, `resolveArticle`, `searchCitingCases`, bridge section resolution
- `src/services/austlii.ts` - AustLII search with authority-based ranking
- `src/services/citation.ts` - AGLC4 formatting, validation, pinpoints
- `src/services/fetcher.ts` - Document retrieval (HTML, PDF, OCR, jade.io GWT-RPC)
- `docs/jade-gwt-protocol.md` - GWT-RPC reverse-engineering documentation

## jade.io GWT-RPC

The jade.io integration uses reverse-engineered GWT-RPC (Google Web Toolkit Remote Procedure Call). Key concepts:

- **Strong names** change on jade.io redeployment; update from HAR captures (see below)
- **proposeCitables** = search/autocomplete endpoint (JadeRemoteService)
- **avd2Request** = fetch judgment content (ArticleViewRemoteService)
- **LeftoverRemoteService** = citation search ("who cites this article") - implemented as `search_citing_cases` tool
- **Bridge section** = last ~10% of proposeCitables flat array; contains record-ID/article-ID pairs
- **Citable IDs** = internal IDs in 2M-10M range (different from article IDs 100-2M); input to citator
- **`.concat()` responses** = GWT splits arrays >32768 elements via `.concat()` join; `parseGwtConcatResponse()` handles this
- Article IDs are resolved via public GET to `jade.io/article/{id}` (no session cookie needed)

### Strong name updates

When jade.io redeploys, the GWT strong names (type hashes) change. To update:
1. Capture a HAR from jade.io (see Proxyman workflow below)
2. Find the `jadeService.do` POST requests
3. Extract the new strong name from the request body (field 4 in the pipe-delimited GWT-RPC payload)
4. Update constants in `src/services/jade-gwt.ts`: `JADE_STRONG_NAME`, `AVD2_STRONG_NAME`, `LEFTOVER_STRONG_NAME`, `JADE_PERMUTATION`
5. Update `docs/jade-gwt-protocol.md`

## Proxyman Debug Workflow

Proxyman captures HTTPS traffic from Chrome for jade.io reverse engineering. CLI at:
`/Applications/Setapp/Proxyman.app/Contents/MacOS/proxyman-cli`

### Commands

```bash
PCLI=/Applications/Setapp/Proxyman.app/Contents/MacOS/proxyman-cli

# Clear session (start fresh capture)
$PCLI clear-session

# Export jade.io traffic as HAR
$PCLI export-log --mode domains --domains 'jade.io' --format har --output /tmp/jade-capture.har

# Export all traffic as HAR
$PCLI export-log --format har --output /tmp/all-traffic.har

# Export flows after a specific flow ID (incremental capture)
$PCLI export-log --format har --since <flow-id> --output /tmp/incremental.har
```

### Typical capture workflow

1. `$PCLI clear-session` - clear previous flows
2. Interact with jade.io in Chrome (search, click article, trigger "cited by", etc.)
3. `$PCLI export-log --mode domains --domains 'jade.io' --format har -o /tmp/jade-capture.har`
4. Parse the HAR with node to extract GWT-RPC request/response bodies

### HAR parsing helper

```javascript
const har = JSON.parse(require("fs").readFileSync("/tmp/jade-capture.har", "utf-8"));
const entries = har.log.entries.filter(e => e.request.url.includes("jadeService.do"));
entries.forEach((e, i) => {
  const body = e.request.postData?.text || "";
  const service = body.match(/JadeRemoteService|ArticleViewRemoteService|LeftoverRemoteService/)?.[0] || "unknown";
  console.log(`${i}: ${service}  respLen=${e.response.content?.text?.length || 0}`);
});
```

## Credentials

- `JADE_SESSION_COOKIE`: 1Password vault `avtgkjcqwia6tzg2swwrzuan44`, item `jvpdjofjrm7srts4kowdjol5dq`, field `credential`
- Retrieve via MCP: `mcp__agent-tools__op_get_secret(vault_id, item_id, "credential")`
- Cookie contains `IID`, `alcsessionid`, `cf_clearance`; expires periodically

## Testing Notes

- Fixtures in `src/test/fixtures/` - static GWT-RPC responses for deterministic unit tests
- Integration tests in `src/test/scenarios.test.ts` hit live AustLII/jade.io; flaky due to network
- Performance tests in `src/test/performance/` have generous timeouts but still flake under load
- The `parseProposeCitablesResponse` near-descriptor article ID offsets do NOT generalise across all responses; the bridge section + `resolveArticle` validation is the reliable path
