# jurisd Agent Usage Guide

**For:** AI agents using jurisd via MCP protocol  
**Transport:** stdio (local) or HTTP (k8s deployment)

---

## Quick Reference

### Search Cases

```json
{
  "tool": "search_cases",
  "arguments": {
    "query": "negligence duty of care",
    "jurisdiction": "vic",
    "limit": 10,
    "sortBy": "date",
    "method": "auto"
  }
}
```

### Search Legislation

```json
{
  "tool": "search_legislation",
  "arguments": {
    "query": "Competition and Consumer Act",
    "jurisdiction": "cth",
    "method": "legis"
  }
}
```

### Fetch Document

```json
{
  "tool": "fetch_document_text",
  "arguments": {
    "url": "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html"
  }
}
```

### Format Citation

```json
{
  "tool": "format_citation",
  "arguments": {
    "title": "Mabo v Queensland (No 2)",
    "neutralCitation": "[1992] HCA 23",
    "reportedCitation": "(1992) 175 CLR 1",
    "pinpoint": "[64]",
    "style": "combined"
  }
}
```

---

## Tool Catalog

### search_cases

**Purpose:** Search Australian and New Zealand case law.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | Yes | Search query |
| jurisdiction | string | No | cth, vic, nsw, qld, sa, wa, tas, nt, act, federal, nz, other |
| limit | number | No | 1-50 (default 10) |
| sortBy | string | No | auto, relevance, date |
| method | string | No | auto, title, phrase, all, any, near, boolean |
| offset | number | No | Pagination (0-based) |
| format | string | No | json, text, markdown, html |

**Method Selection:**
| Method | Use Case |
|--------|----------|
| auto | General use (AustLII decides) |
| title | Finding specific case by name |
| phrase | Exact phrase (e.g., "duty of care") |
| all | All words must appear |
| any | Broad search (any word matches) |
| near | Words near each other |
| boolean | SINO query syntax (power users) |

**Example Queries:**

- "Donoghue v Stevenson" → method: title
- "negligence duty of care" → method: auto or phrase
- "s 52 Trade Practices Act misleading" → method: boolean

**Response Format (JSON):**

```json
[
  {
    "title": "Case Name",
    "neutralCitation": "[2024] HCA 1",
    "reportedCitation": "(2024) 350 ALR 123",
    "jurisdiction": "cth",
    "court": "HCA",
    "date": "2024-02-15",
    "url": "https://www.austlii.edu.au/...",
    "source": "jade",
    "snippet": "..."
  }
]
```

When a source is unavailable but the tool call itself succeeds, JSON responses
use a degraded object instead of the normal array:

```json
{
  "results": [],
  "warnings": [
    {
      "code": "austlii_cloudflare_blocked",
      "source": "austlii",
      "message": "AustLII search is blocked by a Cloudflare challenge. Direct document fetch still works when you already have a URL."
    }
  ],
  "sources": {
    "austlii": "blocked",
    "jade": "not_configured"
  },
  "degraded": true
}
```

Do not treat a degraded empty result as proof that no matching authority exists.
Check `warnings`, `sources`, and `degraded` before relying on search coverage.

---

### search_legislation

**Purpose:** Search Australian and New Zealand legislation.

**Parameters:** Same as search_cases, except:

- method: adds legis option (searches legislation titles)

**Example:**

```json
{
  "query": "Privacy Act",
  "jurisdiction": "cth",
  "method": "legis",
  "limit": 5
}
```

---

### fetch_document_text

**Purpose:** Fetch full text from AustLII or jade.io URL.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| url | string | Yes | Document URL |
| format | string | No | json, text, markdown, html |

**Supported URLs:**

- AustLII HTML: https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html
- AustLII PDF: https://www.austlii.edu.au/...
- jade.io: https://jade.io/article/68901

**Response Format:**

```json
{
  "text": "Full judgment text...",
  "citations": ["[1992] HCA 23"],
  "paragraphs": ["[1] ...", "[2] ..."]
}
```

---

### format_citation

**Purpose:** Format citation per AGLC4 rules — full citations, short forms, and pinpoint generation, selected via `mode`.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| mode | string | No | full (default), short, ibid, subsequent, pinpoint |
| title | string | Yes\* | Case name (abbreviated name for short-form modes) |
| neutralCitation | string | No | [year] court number (full mode) |
| reportedCitation | string | No | (year) volume reporter page (full mode) |
| pinpoint | string | No | [paragraph] or page (full mode) |
| style | string | No | neutral, reported, combined (full mode) |
| footnoteRef | number | Yes for subsequent | Footnote number of first citation |
| pinpointPara / pinpointPage | number | No | Pinpoint for short-form modes |
| url | string | Yes for pinpoint | AustLII document URL to fetch and search |
| paragraphNumber / phrase | number / string | One required for pinpoint | Paragraph to locate |
| caseCitation | string | No | Citation to prepend (pinpoint mode) |

\*Required for all modes except pinpoint.

**Output (`full`):** `Mabo v Queensland (No 2) [1992] HCA 23, (1992) 175 CLR 1 at [64]`

**Response (`pinpoint`):**

```json
{
  "paragraphNumber": 64,
  "pinpointString": "at [64]",
  "fullCitation": "[1992] HCA 23 at [64]",
  "context": "The text surrounding the paragraph..."
}
```

---

### resolve_citation

**Purpose:** Resolve a citation to its authoritative source — validation and search behind one tool, selected via `mode`.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| citation | string | Yes | Citation or case name |
| mode | string | No | auto (default), validate, search |
| format | string | No | Output format |

**Behavior:**

- `auto`: if a neutral citation is detected (e.g., [1992] HCA 23), validates against AustLII and returns the direct URL; otherwise falls back to text search
- `validate`: AustLII existence check only
- `search`: text search only

**Response (`validate`):**

```json
{
  "valid": true,
  "canonicalCitation": "[1992] HCA 23",
  "austliiUrl": "https://www.austlii.edu.au/...",
  "message": "Citation is valid"
}
```

---

### jade_lookup

**Purpose:** Look up jade.io by article ID or neutral citation, selected via `by`.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| by | string | Yes | article_id or citation |
| articleId | number | Yes for article_id | jade.io article ID |
| citation | string | Yes for citation | Neutral citation |

**Response (`by: article_id`):**

```json
{
  "articleId": 68901,
  "caseName": "Mabo v Queensland (No 2)",
  "neutralCitation": "[1992] HCA 23",
  "jurisdiction": "cth",
  "court": "HCA",
  "year": 1992
}
```

**Response (`by: citation`):**

```json
{
  "citation": "[2008] NSWSC 323",
  "jadeUrl": "https://jade.io/article/12345"
}
```

---

### search_citing_cases

**Purpose:** Find cases that cite a given case (jade.io citator).

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| caseName | string | Yes | Case name or citation |
| format | string | No | Output format |

**Response:**

```json
{
  "totalCount": 847,
  "results": [
    {
      "caseName": "Subsequent Case",
      "neutralCitation": "[2020] HCA 5",
      "jadeUrl": "https://jade.io/article/..."
    }
  ]
}
```

---

### cite

**Purpose:** Write to the local citation cache, selected via `action`.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| action | string | No | add (default) or refresh_source |
| title | string | Yes for add | Case name |
| url | string | Yes for add | Primary source URL (AustLII or jade.io) |
| citeKey | string | Yes for refresh_source | Cite key of a cached citation |
| neutralCitation, reportedCitation, type, jurisdiction, year, court, keywords, summary, document, footnoteNumber, pinpoint, style | various | No | Citation metadata (add) |

**Behavior:**

- `add`: stores or updates a citation, assigns a biblatex-compatible cite key on first use, returns `{ citeKey, aglc4Full, cached }`
- `refresh_source`: conditional-HEAD freshness check on the cached source file; re-downloads when the remote is newer

---

### bibliography

**Purpose:** Read from the local citation cache (no network calls), selected via `op`.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| op | string | No | get, list (default), export, cited_by |
| query | string | Yes for get | Cite key, AGLC4 string, neutral citation, or case title |
| citeKey | string | Yes for cited_by | Cite key of the case |
| document | string | No | Filter to one document (list/export) |
| outputPath | string | No | Absolute path for the .bib file (export) |
| format | string | No | Output format |

---

### cache_cited_by

**Purpose:** Fetch citing cases for a cached citation from jade.io and store them locally (requires JADE_SESSION_COOKIE).

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| citeKey | string | Yes | Cite key of the parent case |

---

## Search Strategy Patterns

### Finding a Specific Case

```json
{
  "query": "Mabo v Queensland",
  "method": "title",
  "limit": 5
}
```

### Recent Cases on a Topic

```json
{
  "query": "adverse possession",
  "jurisdiction": "nsw",
  "sortBy": "date",
  "limit": 10
}
```

### High Court Authority Search

```json
{
  "query": "duty of care negligence",
  "jurisdiction": "cth",
  "sortBy": "relevance",
  "limit": 20
}
```

### Exact Phrase Search

```json
{
  "query": "reasonable person",
  "method": "phrase",
  "jurisdiction": "cth"
}
```

### Boolean Query

```json
{
  "query": "negligence + duty + care",
  "method": "boolean"
}
```

### Pagination

```json
{
  "query": "contract breach",
  "limit": 50,
  "offset": 50
}
```

---

## Error Handling

### Rate Limiting

```json
{
  "error": "Rate limit exceeded for AustLII (10 req/min). Retry after 60 seconds."
}
```

**Resolution:** Wait and retry, or reduce query frequency.

### jade.io Auth Required

```json
{
  "error": "jade.io authentication required. Set JADE_SESSION_COOKIE."
}
```

**Resolution:** Provide session cookie via environment variable.

### Invalid URL

```json
{
  "error": "URL not allowed. Only AustLII and jade.io domains permitted."
}
```

**Resolution:** Use allowed domains only (SSRF protection).

---

## Best Practices

1. **Start broad, then narrow:** Begin with auto method, refine with method/title if too many results.

2. **Use jurisdiction filters:** Reduces noise, especially for common legal terms.

3. **Prefer jade.io results:** When both sources return the same case (by neutral citation), jade.io has richer metadata.

4. **Fetch full text for analysis:** Use fetch_document_text before asking detailed questions about a case.

5. **Validate citations:** Always validate neutral citations before citing in formal work.

6. **Use pinpoint for precision:** When referencing specific passages, generate pinpoint citations.

7. **Check citing cases:** Use search_citing_cases to find subsequent treatment of a case.

---

## Example Workflow

**Task:** Research the development of duty of care in Australian negligence law.

**Step 1:** Find leading cases

```json
{
  "tool": "search_cases",
  "arguments": { "query": "duty of care negligence", "jurisdiction": "cth", "limit": 10 }
}
```

**Step 2:** Fetch full text of top result

```json
{ "tool": "fetch_document_text", "arguments": { "url": "https://www.austlii.edu.au/..." } }
```

**Step 3:** Format citation for reference

```json
{ "tool": "format_citation", "arguments": { "title": "...", "neutralCitation": "[2024] HCA 1" } }
```

**Step 4:** Find citing cases

```json
{ "tool": "search_citing_cases", "arguments": { "caseName": "[2024] HCA 1" } }
```

---

## Configuration

### Environment Variables (User-Provided)

| Variable            | Purpose                                       | Required                                    |
| ------------------- | --------------------------------------------- | ------------------------------------------- |
| JADE_SESSION_COOKIE | jade.io authenticated access                  | For jade.io subscription content            |
| ISAACUS_API_KEY     | BYOK key for the optional domain-adapter slot | For the optional domain-specialised adapter |
| LITELLM_BASE_URL    | LiteLLM gateway                               | For generative fallback                     |

---

## Rate Limits

| Source  | Limit       | Window   |
| ------- | ----------- | -------- |
| AustLII | 10 requests | 1 minute |
| jade.io | 5 requests  | 1 minute |

**Note:** These are enforced server-side. Exceeding limits returns errors, not cached results.

---

## Support

- **Documentation:** docs/ directory in repository
- **Issues:** GitHub repository issues
- **Status:** Check /health endpoint (HTTP deployment only)

---

**License:** Apache-2.0
**Contact:** contact@workingmem.ai
