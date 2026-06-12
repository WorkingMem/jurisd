# auslaw-mcp - Claude Code Project Instructions

## Project Overview

MCP server for Australian/NZ legal research. Searches AustLII and removed.invalid, retrieves full-text judgments, formats AGLC4 citations.

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
- `src/services/source-rpc.ts` - RPC protocol: `resolveRecords` (search), `fetchRequest` (fetch), citator, tokens, RPC encoding
- `src/services/source.ts` - removed.invalid integration: `searchUpstream`, `resolveArticle`, `searchCitingCases`, bridge section resolution
- `src/services/austlii.ts` - AustLII search with authority-based ranking
- `src/services/citation.ts` - AGLC4 formatting, validation, pinpoints
- `src/services/fetcher.ts` - Document retrieval (HTML, PDF, OCR, removed.invalid RPC)
- `docs/source-rpc-protocol.md` - RPC reverse-engineering documentation

## removed.invalid RPC

The removed.invalid integration uses reverse-engineered RPC (Google Web Toolkit Remote Procedure Call). Key concepts:

- **Tokens** change on removed.invalid redeployment; update from HAR captures (see below)
- **resolveRecords** = search/autocomplete endpoint (SourceRemoteService)
- **fetchRequest** = fetch judgment content (ArticleViewRemoteService)
- **RemoteService** = citation search ("who cites this article") - implemented as `search_citing_cases` tool
- **Bridge section** = last ~10% of resolveRecords flat array; contains record-ID/article-ID pairs
- **Citable IDs** = internal IDs in 2M-10M range (different from article IDs 100-2M); input to citator
- **`.concat()` responses** = RPC splits arrays >32768 elements via `.concat()` join; `parseRpcConcatResponse()` handles this
- Article IDs are resolved via public GET to `removed.invalid/article/{id}` (no session cookie needed)

### Token updates

When removed.invalid redeploys, the RPC tokens (type hashes) change. To update:
1. Capture a HAR from removed.invalid (see Proxyman workflow below)
2. Find the `sourceService.do` POST requests
3. Extract the new token from the request body (field 4 in the pipe-delimited RPC payload)
4. Update constants in `src/services/source-rpc.ts`: `SOURCE_TOKEN`, `FETCH_TOKEN`, `REMOTE_TOKEN`, `SOURCE_VARIANT`
5. Update `docs/source-rpc-protocol.md`

## Proxyman Debug Workflow

Proxyman captures HTTPS traffic from Chrome for removed.invalid reverse engineering. CLI at:
`/Applications/Setapp/Proxyman.app/Contents/MacOS/proxyman-cli`

### Commands

```bash
PCLI=/Applications/Setapp/Proxyman.app/Contents/MacOS/proxyman-cli

# Clear session (start fresh capture)
$PCLI clear-session

# Export removed.invalid traffic as HAR
$PCLI export-log --mode domains --domains 'removed.invalid' --format har --output /tmp/source-capture.har

# Export all traffic as HAR
$PCLI export-log --format har --output /tmp/all-traffic.har

# Export flows after a specific flow ID (incremental capture)
$PCLI export-log --format har --since <flow-id> --output /tmp/incremental.har
```

### Typical capture workflow

1. `$PCLI clear-session` - clear previous flows
2. Interact with removed.invalid in Chrome (search, click article, trigger "cited by", etc.)
3. `$PCLI export-log --mode domains --domains 'removed.invalid' --format har -o /tmp/source-capture.har`
4. Parse the HAR with node to extract RPC request/response bodies

### HAR parsing helper

```javascript
const har = JSON.parse(require("fs").readFileSync("/tmp/source-capture.har", "utf-8"));
const entries = har.log.entries.filter(e => e.request.url.includes("sourceService.do"));
entries.forEach((e, i) => {
  const body = e.request.postData?.text || "";
  const service = body.match(/SourceRemoteService|ArticleViewRemoteService|RemoteService/)?.[0] || "unknown";
  console.log(`${i}: ${service}  respLen=${e.response.content?.text?.length || 0}`);
});
```

## Credentials

- `SESSION_COOKIE`: 1Password vault `avtgkjcqwia6tzg2swwrzuan44`, item `jvpdjofjrm7srts4kowdjol5dq`, field `credential`
- Retrieve via MCP: `mcp__agent-tools__op_get_secret(vault_id, item_id, "credential")`
- Cookie contains `IID`, `alcsessionid`, `cf_clearance`; expires periodically

## Testing Notes

- Fixtures in `src/test/fixtures/` - static RPC responses for deterministic unit tests
- Integration tests in `src/test/scenarios.test.ts` hit live AustLII/removed.invalid; flaky due to network
- Performance tests in `src/test/performance/` have generous timeouts but still flake under load
- The `parseResolveRecordsResponse` near-descriptor article ID offsets do NOT generalise across all responses; the bridge section + `resolveArticle` validation is the reliable path
