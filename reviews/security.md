# Security Review: auslaw-mcp
**Date:** 2026-03-02
**Scope:** /Users/rbrenner/git/auslaw-mcp/src (full codebase)
**Rating:** Medium
**Reviewer:** security-reviewer

---

## Findings

### [MEDIUM] Unsanitised HTML from external hosts injected into output document

- **Category:** Injection (XSS / HTML Injection)
- **File:** `src/utils/formatter.ts:136–166` and `src/services/fetcher.ts:159–192`
- **Description:**
  When a caller requests `format=html`, `wrapInStyledDocument()` in `formatter.ts` embeds
  `response.html` directly into a `<body>` element without any sanitisation or escaping:

  ```typescript
  // formatter.ts:163-165
  <body>
  ${bodyHtml}        // ← raw HTML from external site, no sanitisation
  </body>
  ```

  `bodyHtml` comes from `cleanHtmlForOutput()` in `fetcher.ts`, which uses cheerio to strip
  `<script>`, `<style>`, `nav`, `header`, `footer`, and certain class names — but cheerio's
  `.html()` re-serialises whatever DOM remains, including:

  - `<iframe>` elements (not removed)
  - `<form>` elements with arbitrary `action` attributes
  - `onload`, `onerror`, `onclick` and other inline event handlers
  - SVG `<animate>` / `<set>` elements
  - `<meta http-equiv="refresh">` redirect tags
  - `<link>` elements with arbitrary `href` (e.g. `rel=prerender`)
  - CSS `url()` references that exfiltrate data

  AustLII and removed.invalid are trusted legal databases, so the probability that their HTML
  contains deliberate XSS payloads is low. However, a compromised or man-in-the-middle
  response on the network path could inject content that, when the MCP host renders the
  returned HTML (e.g. in a browser-based MCP client), executes in that client's context.

- **Impact:**
  If the MCP client renders the returned `text/html` content in a browser context (e.g.
  Electron shell, embedded webview, or a browser-based MCP IDE), a crafted upstream
  response could achieve script execution in the client application. The delivered HTML
  is also returned directly in the MCP tool result, so any downstream consumer that
  renders it is affected.

- **Recommendation:**
  Apply an explicit allowlist-based HTML sanitisation step before inserting `bodyHtml`
  into `wrapInStyledDocument()`. Use a library such as `DOMPurify` (with jsdom) or
  `sanitize-html`, configured to strip all event handlers, `<iframe>`, `<script>`,
  `<object>`, `<embed>`, and SVG animation elements. The cheerio stripping in
  `cleanHtmlForOutput()` is insufficient as a security control — it is designed for
  content extraction, not for security-oriented sanitisation.

---

### [MEDIUM] `validateCitation` constructs a URL with user-controlled path segments without adequate validation

- **Category:** Injection (URL / Path Injection)
- **File:** `src/services/citation.ts:139–164`
- **Description:**
  `validateCitation()` extracts the `court` and `num` capture groups from the
  `NEUTRAL_CITATION_PATTERN` regex and interpolates them directly into a URL path:

  ```typescript
  // constants.ts:10
  export const NEUTRAL_CITATION_PATTERN = /\[(\d{4})\]\s*([A-Za-z0-9]+)\s*(\d+)/;

  // citation.ts:148–153
  const [, year, court, num] = match;
  const path = COURT_TO_AUSTLII_PATH[court!];
  ...
  const url = `https://www.austlii.edu.au/cgi-bin/viewdoc/${path}/${year}/${num}.html`;
  ```

  `COURT_TO_AUSTLII_PATH` is a static dictionary, so any court abbreviation not in the
  table is rejected at line 150. However:

  1. `year` and `num` are validated only to be digit sequences (`\d+` / `\d{4}`), but
     there is no upper-bound length check. A citation like `[2024] HCA 999999999999999`
     produces a well-formed but obviously nonsensical URL. This is low impact in isolation.

  2. More critically: the `court` capture group matches `[A-Za-z0-9]+`, which includes
     numeric digits. An input such as `[2024] FCA00 1` would pass the regex but produce
     `court = "FCA00"`, which fails the dictionary lookup and is rejected. This is safe.

  3. The real concern is that `COURT_TO_AUSTLII_PATH` values themselves are multi-segment
     strings (e.g. `"au/cases/cth/HCA"`). If an attacker could ever control the table
     values (they cannot today — the table is hardcoded), they could inject `../` sequences.
     This is not currently exploitable but is worth noting as a structural risk.

  4. The generated URL is passed to `axios.head()` without going through
     `assertFetchableUrl()`. Although the base hostname is hardcoded as
     `www.austlii.edu.au` in the string template, the absence of the guard means if the
     template were ever modified (e.g. to use `config.austlii.searchBase`), there would
     be no SSRF protection here. The `resolveArticle()` call in `source.ts:204` has the
     same issue — it calls `axios.get(url)` on a URL built from `config.source.baseUrl`
     and user-supplied `articleId` without passing through `assertFetchableUrl()`.

- **Impact:**
  Currently limited impact due to hardcoded base hostnames. However, the structural
  absence of `assertFetchableUrl()` for internally-constructed URLs is a defence-in-depth
  gap that would become exploitable if base URLs were ever made configurable or if the
  construction logic changed.

- **Recommendation:**
  Apply `assertFetchableUrl()` to all outbound HTTP requests, including those where the
  base URL is constructed internally. This ensures a single enforcement point for the
  SSRF allowlist regardless of how the URL was assembled.

---

### [MEDIUM] Session cookie logged in error messages under some error paths

- **Category:** Secrets Exposure
- **File:** `src/services/fetcher.ts:327–336`, `src/index.ts:363–365`
- **Description:**
  When an axios error is thrown after a removed.invalid request, the catch block at
  `fetcher.ts:327` constructs an error message that includes `error.message`, which for
  network-level errors may include the request headers (depending on the axios version
  and error type). The `console.error("Fatal server error", error)` at `index.ts:364`
  would then emit the full error object, potentially including the request config with
  the `Cookie` header set to `sessionCookie`.

  Axios v1.x does not redact headers from error objects by default. The `error.config`
  property on an `AxiosError` includes the full request configuration, including all
  headers. When this is serialised via `console.error`, the session cookie value is
  emitted to stderr.

  Example: if removed.invalid returns a 500 and the MCP host captures stderr, the cookie value
  appears in logs.

- **Impact:**
  The SESSION_COOKIE is a full authenticated session cookie (the README notes it
  includes `IID`, `alcsessionid`, and `cf_clearance` values). Leaking this to logs
  allows anyone with log access to impersonate the user's removed.invalid session.

- **Recommendation:**
  When rethrowing or constructing errors from axios responses, sanitise the error object
  before logging. Specifically, strip `error.config.headers` before passing to
  `console.error`. Alternatively, configure axios with a request interceptor that deletes
  the `Cookie` header from the config before it is stored in the error object.

---

### [LOW] `.mcp.json` committed with an absolute local path, enabling path disclosure

- **Category:** Security Misconfiguration
- **File:** `.mcp.json:6`
- **Description:**
  The `.mcp.json` file references an absolute path to the developer's local filesystem:

  ```json
  "args": ["/Users/rbrenner/git/auslaw-mcp/dist/index.js"]
  ```

  This file appears in `git status` as untracked. If committed, it discloses the local
  username and filesystem layout to anyone with repository access.

- **Impact:**
  Low impact in isolation. Discloses the local username (`rbrenner`) and directory
  structure. Combined with other information, this could assist targeted social
  engineering or aid an attacker enumerating a compromised system.

- **Recommendation:**
  Add `.mcp.json` to `.gitignore` (alongside `.env`), or replace the absolute path with
  a relative or environment-variable-based path before committing. The current
  `.gitignore` does not exclude `.mcp.json`.

---

### [LOW] Unsafe redirect following on outbound requests with no redirect validation

- **Category:** Security Misconfiguration / SSRF (defence-in-depth)
- **File:** `src/services/fetcher.ts:270–275`, `src/services/austlii.ts:281–284`, `src/services/source.ts:204–210`
- **Description:**
  All `axios.get()` calls use the default axios configuration, which follows HTTP
  redirects automatically (via `follow-redirects`). There is no `maxRedirects` cap and
  no post-redirect re-validation of the final URL against the allowlist.

  If AustLII or removed.invalid were ever configured (by accident or compromise) to return a
  redirect to an internal network address (e.g. `http://169.254.169.254/` for cloud
  metadata), axios would follow it. The `assertFetchableUrl()` check in
  `fetchDocumentText` validates the *initial* URL but not the *redirect target*.

  Axios delegates to `follow-redirects`, which does not expose a pre-redirect hook that
  would allow re-running the allowlist check.

- **Impact:**
  In practice, both AustLII and removed.invalid are stable third-party public sites unlikely to
  serve malicious redirects. The risk is theoretical unless those sites are compromised.
  However, in an MCP context where the server might be deployed adjacent to internal
  infrastructure, an open redirect on a trusted domain could pivot to internal services.

- **Recommendation:**
  Set `maxRedirects: 0` on all axios calls to disable automatic redirect following, and
  handle 3xx responses manually with a re-validation step. Alternatively, pass a custom
  `httpsAgent` with `maxRedirects` set to a small value and log all redirect targets.

---

### [INFO] RPC variant and strong-name constants hardcoded

- **Category:** Security Misconfiguration
- **File:** `src/services/source-rpc.ts:30–45`
- **Description:**
  `SOURCE_TOKEN`, `FETCH_TOKEN`, and `SOURCE_VARIANT` are hardcoded
  constants derived from a specific build of removed.invalid's RPC application captured on
  2026-03-02. These values are not secrets, but they are implementation details that
  could change at any removed.invalid redeployment. This is an operational rather than a
  security finding.

  There is no validation that these constants are still valid before use; failure
  manifests as a RPC exception response (`//EX`) from removed.invalid.

- **Impact:** None from a security perspective. Noted for operational awareness.

- **Recommendation:** No immediate security action required.

---

### [INFO] `node-tesseract-ocr` invokes Tesseract via shell command

- **Category:** Injection (defence-in-depth note)
- **File:** `src/services/fetcher.ts:56–75`
- **Description:**
  `tesseract.recognize(tmpFile.name, ocrConfig)` in `node-tesseract-ocr` constructs a
  shell command internally. The `tmpFile.name` is generated by the `tmp` package using
  OS-level temp file creation with a `.pdf` suffix — it is not user-controlled. The
  `ocrConfig` values (`lang`, `oem`, `psm`) come from environment variables validated
  as integers or a language string.

  Reviewed `node-tesseract-ocr` v2.2.1: it uses `child_process.exec` with the filename
  directly. The `tmp.fileSync()` return value uses `os.tmpdir()` and a random suffix,
  making path injection through the filename implausible.

  This is noted for completeness; no exploitation path was identified.

- **Impact:** None identified.

- **Recommendation:** No action required. The OCR language string from `OCR_LANGUAGE`
  env var (`config.ocr.language`) is passed to tesseract. If untrusted users can set
  environment variables, they could attempt to inject shell metacharacters via
  `OCR_LANGUAGE`. In the MCP deployment model, env vars are operator-controlled, so
  this is acceptable. Consider validating `OCR_LANGUAGE` against an allowlist of known
  Tesseract language codes as a defence-in-depth measure.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0     |
| High     | 0     |
| Medium   | 3     |
| Low      | 2     |
| Info     | 2     |

**Key risk areas:**
- Unsanitised external HTML injected into output documents (XSS vector if client renders HTML)
- Missing `assertFetchableUrl()` on internally-constructed outbound requests (defence-in-depth gap)
- Session cookie exposure via unredacted axios error objects in logs

## Recommendations

1. **Sanitise HTML output (Medium, highest priority):** Introduce a proper HTML
   sanitisation step (e.g. `sanitize-html`) in `cleanHtmlForOutput()` or within
   `wrapInStyledDocument()`. Configure it to strip all event handlers, `<iframe>`,
   `<script>`, `<object>`, `<embed>`, `<form>`, and SVG animation elements.

2. **Redact session cookie from error objects (Medium):** In the axios error catch block
   in `fetcher.ts`, strip `error.config.headers.Cookie` before logging or rethrowing the
   error. This prevents the `SESSION_COOKIE` value from appearing in MCP host logs.

3. **Apply `assertFetchableUrl()` to all outbound requests (Medium):** Extend the SSRF
   guard to cover URLs built internally in `citation.ts:validateCitation()` and
   `source.ts:resolveArticle()`, not just those supplied directly by the MCP tool caller.

4. **Add `.mcp.json` to `.gitignore` (Low):** Prevent accidental commit of the file
   containing an absolute local path with the developer's username.

5. **Disable automatic redirect following or add post-redirect validation (Low):** Set
   `maxRedirects: 0` on all axios calls or implement a pre-redirect hook to re-validate
   redirect targets against the SSRF allowlist.

6. **Update vitest/vite dev dependencies (Info):** `npm audit` reports 6 moderate
   severity vulnerabilities in `esbuild <= 0.24.2` (via `vite`/`vitest`). These affect
   the development toolchain only and are not present in the production bundle. Run
   `npm audit fix --force` (accepting the breaking change to vitest v4) to resolve, or
   pin `vitest` to a patched version.
