# auslaw-mcp: Full Roadmap Execution Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Execute all ROADMAP.md items plus expanded personal-workflow features (AGLC4 citation service, removed.invalid as first-class citizen, pinpoint citations, authority ranking, security hardening), with full review/remediate cycles.

**Architecture:** New `src/services/citation.ts` for AGLC4 formatting/validation/pinpoints; removed.invalid session-cookie authenticated fetch injected into `fetcher.ts`; URL allowlist guard; four new MCP tools. All behind a Gitea-only push gate until PII-scan + RHIL clears GitHub push.

**Tech Stack:** TypeScript, Vitest, Cheerio, Axios, pdf-parse, Tesseract OCR, @modelcontextprotocol/sdk, Zod

**PII scan scope:** Legal case data from brenner-v-knorr (opposing party surnames, children's names, addresses, financial identifiers) - NOT the user's own name or @russellbrenner.com email addresses.

---

## Pre-Work: Gitea Remote + Plane Project Setup

### Task P1: Add Gitea remote and prune stale branches

**Files:**
- None (git operations)

**Step 1: Add Gitea remote**
```bash
git remote add gitea git@git.itsa.house:rbrenner/auslaw-mcp.git
git remote -v  # verify both origin and gitea present
```

**Step 2: Push current branch to Gitea**
```bash
git push gitea citation-matching
```

**Step 3: Prune stale local branches already merged into main**
```bash
git fetch --prune origin
# Delete local branches with no active work:
git branch -d phase-2a-reported-citations
git branch -d search-relevance-fix
git branch -d title-matching-boost
# Verify
git branch -a
```

**Step 4: Verify build passes before any further work**
```bash
npm run build && npm test
```

---

### Task P2: Create Plane project for auslaw-mcp

**Files:** None (Plane API)

**Step 1: Create Plane project**

Use `mcp__agent-tools__plane_create_project` with:
- workspace: `auslaw-mcp` (derived from Gitea remote)
- name: `auslaw-mcp Roadmap`
- identifier: `AML`
- description: "MCP server for Australian legal research - roadmap execution"

**Step 2: Create labels**
- waiting (#facc15), in-progress (#3b82f6), review (#a855f7), done (#22c55e), RHIL (#ef4444)

**Step 3: Create Plane work items**

Create items for each phase below. Include `AML-N` identifier in task subjects.

---

## Phase 0: Code Review + Remediation (Quality Baseline)

### Task 0.1: General code review

**Files to read (analysis only):**
- `src/services/fetcher.ts`
- `src/services/austlii.ts`
- `src/services/source.ts`
- `src/utils/formatter.ts`
- `src/index.ts`

**Issues to identify and fix in 0.2/0.3:**

`fetcher.ts`:
- Hardcoded User-Agent instead of `config.source.userAgent`
- `maxContentLength` hardcoded, should use `MAX_CONTENT_LENGTH` from constants
- AUSTLII_HEADERS duplicated vs `austlii.ts`

`austlii.ts`:
- `extractReportedCitation` redefines regex already in `constants.ts` `REPORTED_CITATION_PATTERNS` - import instead
- `boostTitleMatches` regex `/v\.?/` doesn't handle multi-word party names

`source.ts`:
- Inline `SOURCE_USER_AGENT`/`SOURCE_TIMEOUT` duplicate `config.source` - use config
- `resolveArticle` uses `maxContentLength: 50 * 1024` (50KB, may truncate)
- `SOURCE_BASE_URL` duplicated from `config.source.baseUrl`

`formatter.ts`:
- Uses em dash `—` (violates CLAUDE.md - change to ` - `)
- `reportedCitation` field not surfaced in text/markdown/html output

`index.ts`:
- `methodEnum` defined but never used (dead code)
- Version `"0.1.0"` hardcoded

---

### Task 0.2: Remediate DRY/config issues

**Files:**
- Modify: `src/services/fetcher.ts`
- Modify: `src/services/austlii.ts`
- Modify: `src/services/source.ts`
- Modify: `src/utils/formatter.ts`

**Step 1: Write failing test for reportedCitation in formatter output**

File: `src/test/unit/formatter.test.ts`
```typescript
it("text format includes reportedCitation when present", () => {
  const results: SearchResult[] = [{
    title: "Mabo v Queensland (No 2)",
    url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
    source: "austlii",
    type: "case",
    neutralCitation: "[1992] HCA 23",
    reportedCitation: "(1992) 175 CLR 1",
  }];
  const output = formatSearchResults(results, "text");
  expect(output.content[0].text).toContain("(1992) 175 CLR 1");
});
```

**Step 2: Run test to confirm it fails**
```bash
npm test -- --grep "reportedCitation"
```
Expected: FAIL

**Step 3: Fix formatter.ts** - surface `reportedCitation` after `neutralCitation` in text/markdown/html; replace em dash with ` - `

**Step 4: Fix austlii.ts** - import `REPORTED_CITATION_PATTERNS` from constants; fix `boostTitleMatches` party regex

**Step 5: Fix fetcher.ts** - use `config.source.userAgent`, `config.source.timeout`, `MAX_CONTENT_LENGTH`

**Step 6: Fix source.ts** - use `config.source.baseUrl`, `config.source.userAgent`, `config.source.timeout`; increase maxContentLength for article resolution

**Step 7: Run tests**
```bash
npm test
```
Expected: all pass

---

### Task 0.3: Remove dead code + minor fixes

**Files:**
- Modify: `src/index.ts`

**Step 1:** Remove unused `methodEnum`; keep `caseMethodEnum` and `legislationMethodEnum`

**Step 2:** Run build + tests
```bash
npm run build && npm test && npm run lint
```
Expected: all pass

**Step 3: Commit**
```bash
git add src/
git commit -m "$(cat <<'EOF'
refactor: DRY config refs, surface reportedCitation in formatter, remove dead code

- fetcher/source/austlii now use config values instead of hardcoded constants
- austlii imports REPORTED_CITATION_PATTERNS from constants
- formatter surfaces reportedCitation in text/markdown/html formats
- formatter: replace em dash with hyphen
- index: remove unused methodEnum

Co-Authored-By: Claude <noreply@anthropic.com>
AI-Generated: true
EOF
)"
git push gitea citation-matching
```

---

### Task 0.4: Code review via subagent

Spawn `superpowers:code-reviewer` agent against all changed files. Remediate any issues found before proceeding.

---

## Phase 1: Citation Service Foundation (AGLC4)

### Task 1.1: Extend constants.ts

**Files:**
- Modify: `src/constants.ts`

**Step 1: Write failing tests**

File: `src/test/unit/constants.test.ts` - add cases:
```typescript
it("matches FedCFamC2F neutral citation", () => {
  expect("[2022] FedCFamC2F 786".match(NEUTRAL_CITATION_PATTERN)).toBeTruthy();
});
it("matches FedCFamC1F neutral citation", () => {
  expect("[2023] FedCFamC1F 100".match(NEUTRAL_CITATION_PATTERN)).toBeTruthy();
});
```

**Step 2: Run to confirm fail**
```bash
npm test -- --grep "FedCFamC"
```

**Step 3: Update NEUTRAL_CITATION_PATTERN** - change `[A-Z]+` to `[A-Za-z0-9]+` for court code

**Step 4: Add REPORTERS registry** (map of abbreviation -> full name):
```typescript
export const REPORTERS: Record<string, string> = {
  CLR: "Commonwealth Law Reports",
  ALR: "Australian Law Reports",
  ALJR: "Australian Law Journal Reports",
  FCR: "Federal Court Reports",
  FLR: "Federal Law Reports",
  FamLR: "Family Law Reports",
  FLC: "Family Law Cases",
  NSWLR: "New South Wales Law Reports",
  VR: "Victorian Reports",
  QdR: "Queensland Reports",
  SASR: "South Australian State Reports",
  WAR: "Western Australian Reports",
  NZLR: "New Zealand Law Reports",
  NZFLR: "New Zealand Family Law Reports",
};
```

**Step 5: Add COURT_TO_AUSTLII_PATH map** for citation validation:
```typescript
export const COURT_TO_AUSTLII_PATH: Record<string, string> = {
  HCA: "au/cases/cth/HCA",
  FCAFC: "au/cases/cth/FCAFC",
  FCA: "au/cases/cth/FCA",
  FedCFamC1F: "au/cases/cth/FedCFamC1F",
  FedCFamC2F: "au/cases/cth/FedCFamC2F",
  NSWSC: "au/cases/nsw/NSWSC",
  NSWCA: "au/cases/nsw/NSWCA",
  NSWCCA: "au/cases/nsw/NSWCCA",
  VSC: "au/cases/vic/VSC",
  VSCA: "au/cases/vic/VSCA",
  QSC: "au/cases/qld/QSC",
  QCA: "au/cases/qld/QCA",
  SASC: "au/cases/sa/SASC",
  WASC: "au/cases/wa/WASC",
  TASSC: "au/cases/tas/TASSC",
  NTSC: "au/cases/nt/NTSC",
  ACTSC: "au/cases/act/ACTSC",
  NZHC: "nz/cases/NZHC",
  NZCA: "nz/cases/NZCA",
  NZSC: "nz/cases/NZSC",
};
```

**Step 6: Run tests**
```bash
npm test
```
Expected: all pass (including new FedCFamC cases)

---

### Task 1.2: Create citation.ts - interfaces and formatter

**Files:**
- Create: `src/services/citation.ts`
- Create: `src/test/unit/citation.test.ts`

**Step 1: Write failing tests**

```typescript
// src/test/unit/citation.test.ts
import { describe, it, expect } from "vitest";
import { parseCitation, formatAGLC4, isValidNeutralCitation, isValidReportedCitation, shortFormAGLC4 } from "../../services/citation";

describe("parseCitation", () => {
  it("extracts neutral citation from plain string", () => {
    const result = parseCitation("[2022] HCA 5");
    expect(result?.neutralCitation).toBe("[2022] HCA 5");
  });

  it("extracts neutral citation from surrounding text", () => {
    const result = parseCitation("See Mabo v Queensland (No 2) [1992] HCA 23 at [20]");
    expect(result?.neutralCitation).toBe("[1992] HCA 23");
    expect(result?.pinpoint).toBe("[20]");
  });

  it("extracts reported citation", () => {
    const result = parseCitation("(1992) 175 CLR 1");
    expect(result?.reportedCitations[0]).toBe("(1992) 175 CLR 1");
  });

  it("handles FedCFamC2F court code", () => {
    const result = parseCitation("[2022] FedCFamC2F 786");
    expect(result?.neutralCitation).toBe("[2022] FedCFamC2F 786");
  });

  it("returns null for non-citation text", () => {
    expect(parseCitation("hello world")).toBeNull();
  });
});

describe("formatAGLC4", () => {
  it("formats neutral citation only", () => {
    const result = formatAGLC4({ title: "Mabo v Queensland (No 2)", neutralCitation: "[1992] HCA 23" });
    expect(result).toBe("Mabo v Queensland (No 2) [1992] HCA 23");
  });

  it("formats combined citation", () => {
    const result = formatAGLC4({
      title: "Mabo v Queensland (No 2)",
      neutralCitation: "[1992] HCA 23",
      reportedCitation: "(1992) 175 CLR 1",
    });
    expect(result).toBe("Mabo v Queensland (No 2) [1992] HCA 23, (1992) 175 CLR 1");
  });

  it("appends paragraph pinpoint", () => {
    const result = formatAGLC4({
      title: "Mabo v Queensland (No 2)",
      neutralCitation: "[1992] HCA 23",
      pinpoint: "[20]",
    });
    expect(result).toBe("Mabo v Queensland (No 2) [1992] HCA 23 at [20]");
  });
});

describe("isValidNeutralCitation", () => {
  it("returns true for valid neutral citation", () => {
    expect(isValidNeutralCitation("[2024] HCA 26")).toBe(true);
  });
  it("returns false for missing brackets", () => {
    expect(isValidNeutralCitation("HCA 26")).toBe(false);
  });
});
```

**Step 2: Run to confirm all fail**
```bash
npm test -- src/test/unit/citation.test.ts
```

**Step 3: Implement citation.ts**

```typescript
// src/services/citation.ts
import { NEUTRAL_CITATION_PATTERN, REPORTED_CITATION_PATTERNS } from "../constants";
import type { ParagraphBlock } from "./fetcher";

export interface ParsedCitation {
  raw: string;
  neutralCitation?: string;
  reportedCitations: string[];
  pinpoint?: string;
}

export interface CaseInfo {
  title: string;
  neutralCitation?: string;
  reportedCitation?: string;
  pinpoint?: string; // e.g. "[23]" (paragraph) or "456" (page)
}

export type CitationStyle = "neutral" | "reported" | "combined";

export function parseCitation(text: string): ParsedCitation | null { /* ... */ }
export function formatAGLC4(info: CaseInfo, style?: CitationStyle): string { /* ... */ }
export function shortFormAGLC4(title: string, pinpoint?: string): string { /* ... */ }
export function isValidNeutralCitation(citation: string): boolean { /* ... */ }
export function isValidReportedCitation(citation: string): boolean { /* ... */ }
export function normaliseCitation(citation: string): string { /* ... */ }
```

**Step 4: Run tests**
```bash
npm test -- src/test/unit/citation.test.ts
```
Expected: all pass

---

### Task 1.3: Citation validator (AustLII HEAD check)

**Files:**
- Modify: `src/services/citation.ts`
- Modify: `src/test/unit/citation.test.ts`

**Step 1: Write failing tests** (mock axios for unit tests, separate integration block)
```typescript
describe("validateCitation", () => {
  it("returns valid for known neutral citation (mocked)", async () => {
    vi.spyOn(axios, "head").mockResolvedValueOnce({ status: 200 });
    const result = await validateCitation("[1992] HCA 23");
    expect(result.valid).toBe(true);
    expect(result.austliiUrl).toContain("HCA");
  });

  it("returns invalid for unknown citation (mocked 404)", async () => {
    vi.spyOn(axios, "head").mockRejectedValueOnce({ response: { status: 404 } });
    const result = await validateCitation("[9999] HCA 999");
    expect(result.valid).toBe(false);
  });

  describe.skip("integration - live network", () => {
    it("validates [1992] HCA 23 against live AustLII", async () => {
      const result = await validateCitation("[1992] HCA 23");
      expect(result.valid).toBe(true);
      expect(result.austliiUrl).toContain("austlii.edu.au");
    }, 30_000);
  });
});
```

**Step 2: Run to fail**

**Step 3: Implement `validateCitation`** using `COURT_TO_AUSTLII_PATH` map

**Step 4: Run tests**
```bash
npm test -- src/test/unit/citation.test.ts
```

**Step 5: Commit**
```bash
git commit -m "feat: citation service with AGLC4 formatter and AustLII validator

Co-Authored-By: Claude <noreply@anthropic.com>
AI-Generated: true"
git push gitea citation-matching
```

---

## Phase 2: removed.invalid as First-Class Citizen

### Task 2.1: Extend config for session cookie

**Files:**
- Modify: `src/config.ts`
- Create: `src/test/unit/config.test.ts`

**Step 1: Write failing test**
```typescript
it("loads SESSION_COOKIE from env", () => {
  vi.stubEnv("SESSION_COOKIE", "test-cookie-value");
  const cfg = loadConfig();
  expect(cfg.source.sessionCookie).toBe("test-cookie-value");
});

it("sessionCookie is undefined when env var absent", () => {
  vi.unstubAllEnvs();
  const cfg = loadConfig();
  expect(cfg.source.sessionCookie).toBeUndefined();
});
```

**Step 2: Run to fail**

**Step 3: Add `sessionCookie?: string` to Config.source interface and loadConfig()**

**Step 4: Run tests, confirm pass**

---

### Task 2.2: Session cookie injection in fetcher.ts

**Files:**
- Modify: `src/services/fetcher.ts`
- Create: `src/test/unit/fetcher.test.ts`

**Step 1: Write failing tests**
```typescript
it("injects Cookie header for removed.invalid when sessionCookie configured", async () => {
  const getSpy = vi.spyOn(axios, "get").mockResolvedValueOnce({
    data: "<html><body>judgment text here longer than 200 chars...</body></html>",
    headers: { "content-type": "text/html" },
    status: 200,
  });
  vi.stubEnv("SESSION_COOKIE", "SESSIONAUTH=abc123");
  const result = await fetchDocumentText("https://removed.invalid/article/68901");
  expect(getSpy.mock.calls[0][1]?.headers?.Cookie).toBe("SESSIONAUTH=abc123");
});

it("throws helpful error on removed.invalid 401 when no cookie set", async () => {
  vi.spyOn(axios, "get").mockRejectedValueOnce({
    response: { status: 401 }
  });
  await expect(fetchDocumentText("https://removed.invalid/article/12345"))
    .rejects.toThrow("SESSION_COOKIE");
});
```

**Step 2: Run to fail**

**Step 3: Implement in fetcher.ts:**
- Before axios.get: check `isSourceUrl(url)` + `config.source.sessionCookie`
- Sanitise cookie: strip newlines, validate printable ASCII only (`/^[\x20-\x7E]+$/`)
- On removed.invalid 401/403: throw descriptive error
- After extract: if text < 200 chars or contains "Upstream Source - Find recent", add warning to metadata

**Step 4: Improve `extractTextFromHtml` selectors:**
- Add: `div[id^="rpc-"]`, `.source-judgment`, `#article-content`, `.ArticleText`, `[class*="judgment"]`
- Debug log when no selectors match

**Step 5: Run tests**

**Step 6: Add skip-guarded integration test in scenarios.test.ts:**
```typescript
describe.skipIf(!process.env.SESSION_COOKIE)(
  "removed.invalid authenticated fetch",
  () => {
    it("returns substantial judgment text", async () => {
      const result = await fetchDocumentText("https://removed.invalid/article/68901");
      expect(result.text.length).toBeGreaterThan(500);
    });
  }
);
```

**Step 7: Commit**
```bash
git commit -m "feat: removed.invalid session cookie authentication for document fetch

- Add SESSION_COOKIE env var support in config
- Inject Cookie header for removed.invalid requests when configured
- Sanitise cookie value (strip newlines, validate ASCII)
- Helpful error on removed.invalid 401/403
- Improved HTML selectors for authenticated judgment content
- Warn when removed.invalid content appears to be unauthenticated shell

Co-Authored-By: Claude <noreply@anthropic.com>
AI-Generated: true"
git push gitea citation-matching
```

---

## Phase 3: Pinpoint Citation Generation

### Task 3.1: ParagraphBlock extraction in fetcher.ts

**Files:**
- Modify: `src/services/fetcher.ts`

**Step 1: Write failing test**
```typescript
it("extracts paragraph blocks from AustLII HTML with [N] markers", async () => {
  const html = `<html><body>
    <p>[1] First paragraph text here.</p>
    <p>[2] Second paragraph about duty of care.</p>
    <p>[3] Third paragraph concluding.</p>
  </body></html>`;
  vi.spyOn(axios, "get").mockResolvedValueOnce({
    data: html, headers: { "content-type": "text/html" }, status: 200,
  });
  const result = await fetchDocumentText("https://www.austlii.edu.au/case");
  expect(result.paragraphs).toHaveLength(3);
  expect(result.paragraphs?.[1].number).toBe(2);
  expect(result.paragraphs?.[1].text).toContain("duty of care");
});
```

**Step 2: Extend FetchResponse interface:**
```typescript
export interface ParagraphBlock {
  number: number;
  text: string;
  pageNumber?: number;
}

export interface FetchResponse {
  // existing fields...
  paragraphs?: ParagraphBlock[];
}
```

**Step 3: Implement paragraph extraction in `extractTextFromHtml`:**
- Regex: `/^\[(\d+)\]\s*/` at start of text nodes
- Page markers: `<a name="p(\d+)">` or `<span class="page-number">(\d+)</span>`
- Populate `paragraphs[]` array alongside existing `text` string

**Step 4: Run tests, confirm pass**

---

### Task 3.2: Pinpoint generator in citation.ts

**Files:**
- Modify: `src/services/citation.ts`
- Modify: `src/test/unit/citation.test.ts`

**Step 1: Write failing tests**
```typescript
describe("generatePinpoint", () => {
  const paragraphs: ParagraphBlock[] = [
    { number: 1, text: "Background facts." },
    { number: 2, text: "The duty of care applied here." },
    { number: 3, text: "Conclusion and orders." },
  ];

  it("finds paragraph by number", () => {
    const result = generatePinpoint(paragraphs, { paragraphNumber: 2 });
    expect(result?.paragraphNumber).toBe(2);
    expect(result?.pinpointString).toBe("at [2]");
  });

  it("finds paragraph by phrase", () => {
    const result = generatePinpoint(paragraphs, { phrase: "duty of care" });
    expect(result?.paragraphNumber).toBe(2);
  });

  it("returns null when phrase not found", () => {
    expect(generatePinpoint(paragraphs, { phrase: "estoppel" })).toBeNull();
  });

  it("includes page pinpoint when pageNumber available", () => {
    const paras = [{ number: 1, text: "facts", pageNumber: 456 }];
    const result = generatePinpoint(paras, { paragraphNumber: 1 });
    expect(result?.pageString).toBe("at 456");
  });
});
```

**Step 2: Implement `generatePinpoint` in citation.ts**

**Step 3: Run tests, confirm pass**

**Step 4: Commit**
```bash
git commit -m "feat: paragraph block extraction and pinpoint citation generation

Co-Authored-By: Claude <noreply@anthropic.com>
AI-Generated: true"
git push gitea citation-matching
```

---

## Phase 4: New MCP Tools

### Task 4.1: format_citation tool

**Files:**
- Modify: `src/index.ts`
- Modify: `src/test/scenarios.test.ts`

**Step 1: Write failing integration test**
```typescript
it("format_citation returns AGLC4 string", async () => {
  // Call the server tool directly via the MCP SDK test helper
  const result = await callTool("format_citation", {
    title: "Mabo v Queensland (No 2)",
    neutralCitation: "[1992] HCA 23",
    reportedCitation: "(1992) 175 CLR 1",
  });
  expect(result.content[0].text).toBe(
    "Mabo v Queensland (No 2) [1992] HCA 23, (1992) 175 CLR 1"
  );
});
```

**Step 2: Register tool in index.ts**

Zod schema:
```typescript
const formatCitationShape = {
  title: z.string().min(1).describe("Case name, e.g. 'Mabo v Queensland (No 2)'"),
  neutralCitation: z.string().optional().describe("Neutral citation, e.g. '[1992] HCA 23'"),
  reportedCitation: z.string().optional().describe("Reported citation, e.g. '(1992) 175 CLR 1'"),
  pinpoint: z.string().optional().describe("Pinpoint reference, e.g. '[20]'"),
  style: z.enum(["neutral", "reported", "combined"]).default("combined"),
};
```

Handler: call `formatAGLC4()` from citation.ts, return text content.

**Step 3: Run tests, confirm pass**

---

### Task 4.2: validate_citation tool

**Files:**
- Modify: `src/index.ts`

Register tool, call `validateCitation()` from citation.ts. Return JSON with `{ valid, canonicalCitation, austliiUrl, message }`.

---

### Task 4.3: generate_pinpoint tool

**Files:**
- Modify: `src/index.ts`

Schema:
```typescript
const generatePinpointShape = z.object({
  url: z.string().url(),
  paragraphNumber: z.number().int().positive().optional(),
  phrase: z.string().min(1).optional(),
  caseCitation: z.string().optional(),
}).refine(
  (d) => d.paragraphNumber !== undefined || d.phrase !== undefined,
  "Provide at least one of paragraphNumber or phrase"
);
```

Handler:
1. `fetchDocumentText(url)` - get paragraphs
2. `generatePinpoint(response.paragraphs, { paragraphNumber, phrase })`
3. Compose full citation if `caseCitation` provided: `"[2022] FedCFamC2F 786 at [23]"`

---

### Task 4.4: search_by_citation tool

**Files:**
- Modify: `src/index.ts`

Handler:
1. `parseCitation(citation)` - extract neutral citation
2. If neutral found: `validateCitation()` -> get AustLII URL -> return as single SearchResult
3. If not: `searchAustLii(citation, { type: "case", sortBy: "relevance", method: "title", limit: 5 })`

**Step: Commit all 4 tools together**
```bash
git commit -m "feat: add format_citation, validate_citation, generate_pinpoint, search_by_citation MCP tools

Co-Authored-By: Claude <noreply@anthropic.com>
AI-Generated: true"
git push gitea citation-matching
```

---

## Phase 5: Authority-Based Ranking

### Task 5.1: calculateAuthorityScore

**Files:**
- Modify: `src/services/austlii.ts`
- Create: `src/test/unit/austlii.test.ts`

**Step 1: Write failing tests**
```typescript
it("HCA scores higher than NSWSC", () => {
  const hca = { url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/2024/1.html", ... };
  const nswsc = { url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/nsw/NSWSC/2024/1.html", ... };
  expect(calculateAuthorityScore(hca)).toBeGreaterThan(calculateAuthorityScore(nswsc));
});

it("reported citation adds score", () => {
  const withReported = { url: "...NSWSC...", reportedCitation: "(2024) 350 ALR 123", ... };
  const withoutReported = { url: "...NSWSC...", reportedCitation: undefined, ... };
  expect(calculateAuthorityScore(withReported)).toBeGreaterThan(calculateAuthorityScore(withoutReported));
});
```

**Step 2: Implement and export `calculateAuthorityScore`:**
```typescript
const URL_SCORES: Array<[RegExp, number]> = [
  [/\/HCA\//, 100],
  [/\/FCAFC\//, 80],
  [/\/FedCFamC1F\//, 70],
  [/\/FCA\//, 60],
  [/\/FedCFamC2F\//, 50],
  [/\/NSWCA\/|\/VSCA\/|\/QCA\//, 50],
  [/\/NSWSC\/|\/VSC\/|\/QSC\//, 30],
];
```

Apply in `searchAustLii` when `sortBy === "auto"` and query is a case name: secondary-sort by authority score after title-match boost.

**Step 3: Commit**
```bash
git commit -m "feat: authority-based scoring for search result ranking

Co-Authored-By: Claude <noreply@anthropic.com>
AI-Generated: true"
git push gitea citation-matching
```

---

## Phase 6: Security + Adversarial Review

### Task 6.1: URL allowlist guard

**Files:**
- Create: `src/utils/url-guard.ts`
- Create: `src/test/unit/url-guard.test.ts`
- Modify: `src/services/fetcher.ts`

**Step 1: Write failing tests**
```typescript
it("permits AustLII HTTPS URL", () => {
  expect(() => assertFetchableUrl("https://www.austlii.edu.au/case")).not.toThrow();
});
it("permits removed.invalid HTTPS URL", () => {
  expect(() => assertFetchableUrl("https://removed.invalid/article/12345")).not.toThrow();
});
it("blocks file:// URL", () => {
  expect(() => assertFetchableUrl("file:///etc/passwd")).toThrow();
});
it("blocks localhost", () => {
  expect(() => assertFetchableUrl("https://localhost:8080/path")).toThrow();
});
it("blocks HTTP (non-HTTPS)", () => {
  expect(() => assertFetchableUrl("http://www.austlii.edu.au/case")).toThrow();
});
it("blocks arbitrary external host", () => {
  expect(() => assertFetchableUrl("https://evil.com/path")).toThrow();
});
```

**Step 2: Implement url-guard.ts:**
```typescript
const ALLOWED_HOSTS = new Set([
  "www.austlii.edu.au",
  "classic.austlii.edu.au",
  "austlii.edu.au",
  "removed.invalid",
  "www.removed.invalid",
]);

export function assertFetchableUrl(url: string): void {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error(`Invalid URL: ${url}`); }
  if (parsed.protocol !== "https:") throw new Error(`Only HTTPS permitted. Got: ${parsed.protocol}`);
  if (!ALLOWED_HOSTS.has(parsed.hostname)) throw new Error(`Host '${parsed.hostname}' not in permitted list`);
}
```

**Step 3: Call `assertFetchableUrl(url)` at top of `fetchDocumentText`**

**Step 4: Run tests, confirm pass**

---

### Task 6.2: Cookie sanitisation

Already implemented in Task 2.2. Verify tests cover:
- Newline injection rejected
- Non-ASCII rejected

---

### Task 6.3: Rate limiter

**Files:**
- Create: `src/utils/rate-limiter.ts`

Simple token bucket (no external deps). Singletons: `austliiRateLimiter` (10/min), `upstreamRateLimiter` (5/min).

Apply `await austliiRateLimiter.throttle()` before AustLII fetch, `await upstreamRateLimiter.throttle()` before removed.invalid fetch.

Test with `vi.useFakeTimers()`.

---

### Task 6.4: Run adversarial review agent

Spawn `adversarial-reviewer` agent against `src/` directory. Focus:
- SSRF surface (already guarded by url-guard, verify thoroughness)
- Cookie handling
- Regex ReDoS potential
- Input validation gaps

Remediate any findings before proceeding.

---

### Task 6.5: Commit security hardening
```bash
git commit -m "security: URL allowlist guard, cookie sanitisation, rate limiting

- assertFetchableUrl() blocks SSRF, non-HTTPS, private hosts
- Cookie validation strips newlines, rejects non-ASCII
- Token bucket rate limiter: 10 req/min AustLII, 5 req/min removed.invalid

Co-Authored-By: Claude <noreply@anthropic.com>
AI-Generated: true"
git push gitea citation-matching
```

---

## Phase 7: Documentation, Coverage, Final Cleanup

### Task 7.1: Coverage check and gap fill
```bash
npm run test:coverage
```
Target: 70% lines/functions/branches/statements. Fix any gaps, particularly in citation.ts edge cases.

### Task 7.2: Update ROADMAP.md

Mark Phase 2B, 3, 4 as COMPLETED. Add new phases (citation service, security) as completed.

### Task 7.3: Update README.md

Add:
- New MCP tools with parameter tables
- `SESSION_COOKIE` setup guide (DevTools extraction, treat like a password)
- AGLC4 citation format examples
- k8s ConfigMap reference for the env var

### Task 7.4: Save plan to repo
```bash
mkdir -p plans
cp ~/.claude/plans/glistening-snuggling-naur.md plans/2026-03-01-auslaw-mcp-full-roadmap.md
git add plans/ docs/ROADMAP.md README.md
git commit -m "docs: track full roadmap implementation plan and updates

Co-Authored-By: Claude <noreply@anthropic.com>
AI-Generated: true"
git push gitea citation-matching
```

### Task 7.5: Final build verification
```bash
npm run build && npm test && npm run test:coverage && npm run lint
```
All must pass.

---

## Phase 8: PII Scan + RHIL Gate (before GitHub push)

### Task 8.1: PII scan

Run a scan for legal case-specific identifiers that should NOT appear in the codebase:
- Opposing party names from the family law matter
- Children's names
- Specific addresses or financial account numbers from the case

**NOT flagged as PII:** The user's own name, @russellbrenner.com email addresses.

Scan using grep across all test fixtures, example data, and documentation:
```bash
# Run against src/, docs/, plans/, tests/
grep -r "Knorr" . --include="*.ts" --include="*.md"
# Replace with regex for other case-specific identifiers
```

If any case-specific identifiers found in code/fixtures: replace with generic placeholders before marking complete.

### Task 8.2: RHIL gate - apply label and notify

Apply RHIL label to the GitHub push Plane item. User must approve before any `git push origin` commands are run.

Permitted until RHIL clears:
- `git push gitea` (Gitea only)

NOT permitted until RHIL clears:
- `git push origin` (GitHub)
- `gh pr create`
- Any GitHub API operations

### Task 8.3: Post-RHIL - create PR

After user approves RHIL:
```bash
git push origin citation-matching
gh pr create --title "feat: full roadmap execution - citation service, removed.invalid auth, security hardening" \
  --body "$(cat <<'EOF'
## Summary
- AGLC4 citation formatter, validator, and pinpoint generator
- removed.invalid session-cookie authenticated content fetching
- 4 new MCP tools: format_citation, validate_citation, generate_pinpoint, search_by_citation
- Authority-based ranking for search results
- SSRF protection, rate limiting, cookie sanitisation

## PII Scan
Completed. No case-specific legal PII found in code or fixtures.

## Test plan
- [ ] All unit tests pass: `npm test`
- [ ] Coverage >= 70%: `npm run test:coverage`
- [ ] Build passes: `npm run build`
- [ ] Lint clean: `npm run lint`
- [ ] removed.invalid auth tested manually with SESSION_COOKIE set

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)
EOF
)"
```

---

## Verification (End-to-End)

Run after all phases complete:

```bash
# 1. Build
npm run build

# 2. Unit tests
npm test

# 3. Coverage (must meet 70% threshold)
npm run test:coverage

# 4. Lint
npm run lint

# 5. Manual MCP tool smoke test (start server, call tools):
node dist/index.js
# In separate terminal or MCP client:
# search_cases: query="Mabo v Queensland", jurisdiction="cth"
# format_citation: title="Mabo v Queensland (No 2)", neutralCitation="[1992] HCA 23", reportedCitation="(1992) 175 CLR 1"
# validate_citation: citation="[1992] HCA 23"
# search_by_citation: citation="[1992] HCA 23"

# 6. removed.invalid authenticated test (requires SESSION_COOKIE):
SESSION_COOKIE="<your-cookie>" npm test -- --grep "removed.invalid authenticated"
```

---

## Critical Files Reference

| File | Status | Changes |
|------|--------|---------|
| `src/services/citation.ts` | CREATE | AGLC4 formatter, parser, validator, pinpoint gen |
| `src/services/fetcher.ts` | MODIFY | Session cookie inject, ParagraphBlock, url-guard call |
| `src/services/austlii.ts` | MODIFY | Import REPORTED_CITATION_PATTERNS, authority score |
| `src/services/source.ts` | MODIFY | Use config values, improved selectors |
| `src/utils/url-guard.ts` | CREATE | assertFetchableUrl SSRF protection |
| `src/utils/rate-limiter.ts` | CREATE | Token bucket rate limiter |
| `src/utils/formatter.ts` | MODIFY | reportedCitation in output, em dash fix |
| `src/constants.ts` | MODIFY | Updated NEUTRAL_CITATION_PATTERN, REPORTERS, COURT_TO_AUSTLII_PATH |
| `src/config.ts` | MODIFY | source.sessionCookie field |
| `src/index.ts` | MODIFY | 4 new tools, remove dead methodEnum |
| `src/test/unit/citation.test.ts` | CREATE | Full citation service tests |
| `src/test/unit/url-guard.test.ts` | CREATE | URL guard tests |
| `src/test/unit/fetcher.test.ts` | CREATE | Fetcher unit tests (mocked) |
| `src/test/unit/config.test.ts` | CREATE | Config loader tests |
| `src/test/unit/austlii.test.ts` | CREATE | Authority scorer tests |
| `docs/ROADMAP.md` | MODIFY | Mark phases complete |
| `README.md` | MODIFY | New tools, removed.invalid cookie setup |
| `plans/2026-03-01-auslaw-mcp-full-roadmap.md` | CREATE | This plan |

---

## Git Push Rules (MANDATORY)

- **`git push gitea`**: Permitted at any time during implementation
- **`git push origin` / `gh pr create`**: BLOCKED until PII-scan complete and RHIL approved by user
- All commits: must include `Co-Authored-By: Claude <noreply@anthropic.com>` and `AI-Generated: true`
- Stale GitHub branches (copilot/*, claude/*): prune after origin push is permitted
