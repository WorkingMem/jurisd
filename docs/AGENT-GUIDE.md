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
{
  "results": [
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
}
```

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
  "ocrUsed": false,
  "paragraphs": ["[1] ...", "[2] ..."]
}
```

---

### format_citation

**Purpose:** Format citation per AGLC4 rules.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| title | string | Yes | Case name |
| neutralCitation | string | No | [year] court number |
| reportedCitation | string | No | (year) volume reporter page |
| pinpoint | string | No | [paragraph] or page |
| style | string | No | neutral, reported, combined |

**Output:** `Mabo v Queensland (No 2) [1992] HCA 23, (1992) 175 CLR 1 at [64]`

---

### validate_citation

**Purpose:** Verify neutral citation exists on AustLII.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| citation | string | Yes | Neutral citation to validate |

**Response:**

```json
{
  "valid": true,
  "canonicalCitation": "[1992] HCA 23",
  "austliiUrl": "https://www.austlii.edu.au/...",
  "message": "Citation is valid"
}
```

---

### generate_pinpoint

**Purpose:** Generate pinpoint citation to specific paragraph.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| url | string | Yes | AustLII document URL |
| paragraphNumber | number | No* | Paragraph number |
| phrase | string | No* | Phrase to find |
| caseCitation | string | No | Citation to prepend |

\*At least one of paragraphNumber or phrase required.

**Response:**

```json
{
  "paragraphNumber": 64,
  "pinpointString": "at [64]",
  "fullCitation": "[1992] HCA 23 at [64]",
  "context": "The text surrounding the paragraph..."
}
```

---

### search_by_citation

**Purpose:** Find case by citation.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| citation | string | Yes | Citation or case name |
| format | string | No | Output format |

**Behavior:**

- If neutral citation detected (e.g., [1992] HCA 23), validates and returns direct URL
- Otherwise falls back to text search

---

### resolve_jade_article

**Purpose:** Get jade.io article metadata by ID.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| articleId | number | Yes | jade.io article ID |

**Response:**

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

---

### jade_citation_lookup

**Purpose:** Generate jade.io lookup URL for a citation.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| citation | string | Yes | Neutral citation |

**Response:**

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

| Variable            | Purpose                      | Required                |
| ------------------- | ---------------------------- | ----------------------- |
| JADE_SESSION_COOKIE | jade.io authenticated access | For premium content     |
| ISAACUS_API_KEY     | Isaacus enrichment tools     | For AI features         |
| LITELLM_BASE_URL    | LiteLLM gateway              | For generative fallback |

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

**License:** MIT  
**Contact:** russellbrenner@users.noreply.github.com
