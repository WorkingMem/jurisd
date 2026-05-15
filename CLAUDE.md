# auslaw-mcp - Claude Code Project Instructions

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

## When auslaw-mcp returns a Cloudflare 403

The server self-heals via a small chain of refresh paths, tried in order:

1. **Host-side cookie bridge** (preferred — sandbox-proof). If `AUSTLII_COOKIE_BRIDGE_URL` is set in the server's env (typically `http://127.0.0.1:8765`), the server GETs `/cookie` from that URL on 401/403. The bridge is a separate process running on the user's host (started via `scripts/austlii-cookie-bridge.mjs` or the launchd plist in `scripts/launchd/`). It has filesystem + Keychain access to Chrome and serves whatever cookies Chrome currently has. Works regardless of where the MCP server runs.

2. **Local script** (fallback for host installs). If the bridge isn't available or returns nothing, the server runs `scripts/refresh-austlii-cookie.mjs` directly. Requires filesystem + Keychain access to Chrome — works when the MCP server is on the host but typically fails in Cowork sandboxes.

3. **Explicit cookie paste** via the `refresh_austlii_cookie` MCP tool. If both auto paths fail, the model can call this tool with a `cookie` parameter the user has copied from DevTools.

After any path succeeds, `process.env.AUSTLII_COOKIE` is updated and the failing request is retried once. Whenever Chrome's stored cookies are fresher than the server's view, the retry succeeds and the model never sees the 403.

### Recovery when the model *does* see the 403

This means Chrome's stored cookies are stale (the user hasn't visited AustLII recently, or Cloudflare invalidated them). The error message is the *afterRefresh* one. Procedure:

1. **Ask the user to open https://www.austlii.edu.au/ in their Chrome and submit any search via the search box.** A real form submission consistently triggers Cloudflare to mint fresh cookies; direct URL navigation usually doesn't. Wait for the user to confirm the search results have loaded.

2. **Retry the original failing tool call.** If the bridge or local-script path is configured and working, the retry should succeed automatically — the refresh will pick up Chrome's freshly-issued cookies. No further action needed.

3. **Only if step 2 fails**, fall back to the paste path:
   - Ask the user to copy the `cf_clearance` value from Chrome DevTools (⌘+⌥+I → Application → Cookies → www.austlii.edu.au → cf_clearance, copy the Value column).
   - Call `mcp__auslaw-mcp__refresh_austlii_cookie(cookie="cf_clearance=<value>")`.
   - Retry the original tool.

### Setting up the cookie bridge (one-time, host-side)

For sandboxed setups (Cowork, etc.), this is the recommended setup:

```bash
# Start it foreground (^C to stop):
node scripts/austlii-cookie-bridge.mjs

# Or load it as a launchd agent that auto-starts on login:
sed "s|PATH_TO_REPO|$HOME/auslaw-mcp|g" scripts/launchd/com.auslaw.cookie-bridge.plist \
  > ~/Library/LaunchAgents/com.auslaw.cookie-bridge.plist
launchctl load ~/Library/LaunchAgents/com.auslaw.cookie-bridge.plist

# Set in auslaw-mcp's env (in .env, .mcp.json, or wherever the server reads from):
AUSTLII_COOKIE_BRIDGE_URL=http://127.0.0.1:8765
```

The bridge logs each request to stderr, so you can `tail /tmp/austlii-cookie-bridge.out.log` (or wherever you redirected) to confirm the MCP server is reaching it.

### Don't

- Don't try `chrome-devtools` MCP — it spawns an isolated Chrome with no fingerprint, Cloudflare loops indefinitely.
- Don't drive Chrome to a `/cgi-bin/sinosrch.cgi` URL via `open` or `mcp__Claude_in_Chrome__navigate` and expect cookies to refresh. They typically won't (`/cgi-bin/sinosrch.cgi` returns 410 Gone for direct navigation, and Cloudflare's silent-pass behaviour means no fresh cookies get issued). Have the user submit a search through the form.
- Don't fall back to manual cookie pasting *unless* the bridge / script paths have both failed for this user. Pasting is a fallback, not the first option.

### The `AUSTLII_USER_AGENT`

The User-Agent does **not** need refreshing on each cookie rotation as long as the user's Chrome version doesn't change. If Chrome auto-updates and refreshes start failing despite the cookie being fresh, capture the new UA via `mcp__Claude_in_Chrome__javascript_tool` running `navigator.userAgent` and update `AUSTLII_USER_AGENT` in `.env`.

### Architectural note (background only)

We previously experimented with auto-nudging Chrome via `open -a "Google Chrome"` to force a fresh Cloudflare challenge. It doesn't reliably work: Cloudflare scores Chrome's existing fingerprint highly enough to pass without issuing fresh cookies. A real form submission from the user's hand is the only path that consistently mints fresh cookies. The bridge + paste tool exist to bridge from "user has fresh cookies in Chrome" to "MCP server has those cookies in process.env" — regardless of how the MCP server is sandboxed.

## Key Architecture

- `src/index.ts` - MCP server, 10 tool registrations
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
