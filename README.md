# jurisd

Model Context Protocol (MCP) server for Australian and New Zealand legal research. Searches AustLII for case law and legislation, retrieves full-text judgements with paragraph numbers preserved, and supports OCR for scanned PDFs.

**Status**: ✅ Full-featured with AGLC4 citation service, removed.invalid authentication, and security hardening

## Features

### Current Capabilities

- ✅ **Case law search**: Natural language queries across all Australian and NZ jurisdictions
- ✅ **All jurisdictions**: Commonwealth, all States/Territories (VIC, NSW, QLD, SA, WA, TAS, NT, ACT), and New Zealand
- ✅ **Intelligent search relevance**: Auto-detects case name queries vs topic searches
  - Case name queries (e.g., "Donoghue v Stevenson") use relevance sorting
  - Topic queries (e.g., "negligence duty of care") use date sorting for recent cases
- ✅ **Multiple search methods**: Title-only, phrase, boolean, proximity searches
- ✅ **Pagination**: Retrieve additional pages of results with offset parameter
- ✅ **Legislation search**: Find Australian and NZ legislation
- ✅ **Primary sources only**: Filters out journal articles and commentary
- ✅ **Citation extraction**: Extracts neutral citations `[2025] HCA 26` and reported citations `(2024) 350 ALR 123`
- ✅ **AGLC4 citation formatting**: Format, validate, and generate pinpoint citations per AGLC4 rules
- ✅ **removed.invalid authenticated fetch**: Fetch full judgment text from removed.invalid using your session cookie
- ✅ **removed.invalid search**: Case search via `resolveRecords` RPC (reverse-engineered); results merged with AustLII, deduplicated by neutral citation. Requires `SESSION_COOKIE`.
- ✅ **Paragraph blocks**: `[N]` paragraph markers extracted as structured blocks for pinpoint citations
- ✅ **Authority-based ranking**: Results ranked by court hierarchy (HCA > FCAFC > FCA > state courts)
- ✅ **Multiple formats**: JSON, text, markdown, or HTML output
- ✅ **Document retrieval**: Full text from HTML and PDF sources (AustLII, removed.invalid)
- ✅ **OCR support**: Tesseract OCR fallback for scanned PDFs
- ✅ **SSRF protection**: URL allowlist restricts fetches to AustLII and removed.invalid only
- ✅ **Rate limiting**: 10 req/min for AustLII, 5 req/min for removed.invalid

### Roadmap

- ✅ **removed.invalid search**: Implemented via reverse-engineered `resolveRecords` RPC — requires `SESSION_COOKIE`
- 🔶 **Upstream Source integration**: Requires contacting Upstream for API access

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full development history and future plans.

## Documentation

| Document                                          | Description                                                                   |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md)           | System architecture, deployment topology, CI/CD pipeline, production patterns |
| [DECISIONS.md](docs/DECISIONS.md)                 | Architectural decision records (ADRs) with context and consequences           |
| [AGENT-GUIDE.md](docs/AGENT-GUIDE.md)             | Agent-facing usage guide with tool catalog and examples                       |
| [DOCKER.md](docs/DOCKER.md)                       | Docker deployment guide                                                       |
| [ROADMAP.md](docs/ROADMAP.md)                     | Development history and future plans                                          |
| [source-rpc-protocol.md](docs/source-rpc-protocol.md) | removed.invalid RPC reverse-engineering details                                   |

## Quick Start

### Run with npx (no local clone required)

```bash
npx -y github:russellbrenner/jurisd
```

`npx` clones the repository, installs dependencies, builds, and launches the
MCP server over stdio in one step. Use this for the simplest install path or
when configuring an MCP-compatible client (see [MCP Registration](#mcp-registration)).

### Local Development

```bash
git clone https://github.com/russellbrenner/jurisd.git
cd jurisd
npm install
npm run dev  # hot reload for local development
```

To build for production:

```bash
npm run build
npm start
```

### Docker Deployment

```bash
# Build the Docker image
docker build -t jurisd:latest .

# Run with Docker Compose
docker-compose up

# Or run directly
docker run -it --rm jurisd:latest
```

See [docs/DOCKER.md](docs/DOCKER.md) for detailed Docker deployment instructions.

### Kubernetes (k3s) Deployment

```bash
# Build and import image to k3s nodes
docker build -t jurisd:latest .
docker save jurisd:latest -o jurisd.tar

# Deploy to k3s cluster
kubectl apply -f k8s/
```

See [k8s/README.md](k8s/README.md) for complete Kubernetes deployment guide.

## MCP Registration

Configure your MCP-compatible client (eg. Claude Desktop, Cursor, Claude Code)
to launch the server.

### Option A — npx (no clone required)

```json
{
  "mcpServers": {
    "jurisd": {
      "command": "npx",
      "args": ["-y", "github:russellbrenner/jurisd"]
    }
  }
}
```

The first invocation clones the repo, installs deps, and builds. Subsequent
launches reuse the cached install. To pin to a specific commit or branch,
append `#<ref>` to the URL — eg. `github:russellbrenner/jurisd#main`.

### Option B — Local clone

For Claude Desktop, edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jurisd": {
      "command": "node",
      "args": ["/path/to/jurisd/dist/index.js"]
    }
  }
}
```

Replace `/path/to/jurisd` with the actual path to your installation.

## Example Queries for AI Assistants

Once the MCP is connected, you can ask an AI assistant like Claude natural language questions. Here are examples organised by use case:

### Finding Recent Decisions

> "What cases were decided by Australian courts today?"

> "Show me the latest Federal Court decisions from this week"

> "Find recent Victorian Supreme Court cases about contract disputes"

> "What are the newest High Court judgments?"

### Researching Legal Topics

> "Find Australian cases about duty of care in professional negligence"

> "Search for cases dealing with unfair dismissal in the construction industry"

> "What are the leading cases on misleading and deceptive conduct under the ACL?"

> "Find cases about breach of directors' duties in the last 2 years"

> "Search for NSW cases involving defamation on social media"

### Finding Specific Cases

> "Find the Mabo case"

> "Look up Donoghue v Stevenson"

> "Find the High Court decision in Palmer v McGowan"

> "Search for Re Wakim - the constitutional case about cross-vesting"

### Comparing Jurisdictions

> "Compare how Victoria and New South Wales courts have treated non-compete clauses"

> "Find Queensland cases about adverse possession"

> "What's the leading New Zealand case on unjust enrichment?"

### Legislation Research

> "Find the Privacy Act"

> "Search for legislation about workplace health and safety in Victoria"

> "What Commonwealth legislation deals with competition law?"

> "Find the New Zealand equivalent of the Australian Consumer Law"

### Deep Research Tasks

> "Find cases that have considered section 52 of the Trade Practices Act and summarise how courts have interpreted 'misleading and deceptive conduct'"

> "Research the development of the 'reasonable person' test in negligence across Australian jurisdictions"

> "Find all High Court cases about constitutional implied freedoms in the last 10 years and identify the key principles"

### Document Retrieval

> "Fetch the full text of [2024] HCA 1 and summarise the key holdings"

> "Get the judgment in Mabo v Queensland (No 2) and explain the doctrine of native title it established"

## Available Tools

10 tools. Operation variants are selected via a `mode`/`op`/`action`/`by` parameter on the relevant tool (see [docs/decisions/tool-surface.md](docs/decisions/tool-surface.md)).

### search_cases

Search Australian and New Zealand case law.

**Parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `query` | Yes | Search query (e.g., "negligence duty of care", "Mabo v Queensland") |
| `jurisdiction` | No | Filter: `cth`, `vic`, `nsw`, `qld`, `sa`, `wa`, `tas`, `nt`, `act`, `federal`, `nz`, `other` |
| `limit` | No | Max results 1-50 (default 10) |
| `sortBy` | No | `auto` (default), `relevance`, or `date` |
| `method` | No | `auto`, `title`, `phrase`, `all`, `any`, `near`, `boolean` |
| `offset` | No | Skip first N results for pagination (e.g., 50 for page 2) |
| `format` | No | `json` (default), `text`, `markdown`, `html` |

**Search Methods:**
| Method | Description | Best For |
|--------|-------------|----------|
| `auto` | AustLII decides | General use |
| `title` | Search case names only | Finding specific cases by name |
| `phrase` | Exact phrase match | Legal terms of art |
| `all` | All words must appear | Precise searches |
| `any` | Any word matches | Broad searches |
| `near` | Words near each other | Conceptual searches |
| `boolean` | Raw SINO query syntax | Power users |

**Examples:**

Find a specific case:

```json
{
  "query": "Donoghue v Stevenson",
  "method": "title",
  "limit": 5
}
```

Recent NSW cases on a topic:

```json
{
  "query": "adverse possession",
  "jurisdiction": "nsw",
  "sortBy": "date",
  "limit": 10
}
```

Exact phrase search:

```json
{
  "query": "duty of care",
  "method": "phrase",
  "jurisdiction": "cth",
  "limit": 20
}
```

Pagination (get results 51-100):

```json
{
  "query": "contract breach",
  "limit": 50,
  "offset": 50
}
```

### search_legislation

Search Australian and New Zealand legislation.

**Parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `query` | Yes | Search query |
| `jurisdiction` | No | Filter: `cth`, `vic`, `nsw`, `qld`, `sa`, `wa`, `tas`, `nt`, `act`, `nz`, `other` |
| `limit` | No | Max results 1-50 (default 10) |
| `sortBy` | No | `auto` (default), `relevance`, or `date` |
| `method` | No | `auto`, `title`, `phrase`, `all`, `any`, `near`, `legis`, `boolean` |
| `offset` | No | Skip first N results for pagination |
| `format` | No | `json` (default), `text`, `markdown`, `html` |

**Example:**

```json
{
  "query": "Privacy Act",
  "jurisdiction": "cth",
  "method": "legis",
  "limit": 10
}
```

### fetch_document_text

Fetch full text from a case or legislation URL. Supports AustLII HTML, PDF with OCR fallback, and removed.invalid authenticated fetch via RPC (requires `SESSION_COOKIE`).

**Parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | Yes | URL of the document (AustLII or removed.invalid) |
| `citeKey` | No | Cite key of a cached citation to associate with this fetch (saves a local source copy) |
| `format` | No | `json` (default), `text`, `markdown`, `html` |

**Example:**

```json
{
  "url": "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html"
}
```

### format_citation

Format an Australian case citation per AGLC4 rules. One tool for full citations, short forms, and pinpoint generation, selected via `mode`.

**Parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `mode` | No | `full` (default), `short`, `ibid`, `subsequent`, `pinpoint` |
| `title` | Yes\* | Case name, e.g. `Mabo v Queensland (No 2)` (abbreviated name for short-form modes) |
| `neutralCitation` | No | Neutral citation, e.g. `[1992] HCA 23` (`full` mode) |
| `reportedCitation` | No | Reported citation, e.g. `(1992) 175 CLR 1` (`full` mode) |
| `pinpoint` | No | Pinpoint reference, e.g. `[20]` (`full` mode) |
| `style` | No | `combined` (default), `neutral`, or `reported` (`full` mode) |
| `footnoteRef` | Yes for `subsequent` | Footnote number of first citation |
| `pinpointPara` / `pinpointPage` | No | Pinpoint for short-form modes |
| `url` | Yes for `pinpoint` | AustLII document URL to fetch and search |
| `paragraphNumber` / `phrase` | One required for `pinpoint` | Paragraph to locate |
| `caseCitation` | No | Citation to prepend to the pinpoint, e.g. `[1992] HCA 23` |

\*Required for all modes except `pinpoint`.

**Example (`full`):**

```json
{
  "title": "Mabo v Queensland (No 2)",
  "neutralCitation": "[1992] HCA 23",
  "reportedCitation": "(1992) 175 CLR 1",
  "pinpoint": "[64]"
}
```

**Output:** `Mabo v Queensland (No 2) [1992] HCA 23, (1992) 175 CLR 1 at [64]`

**Example (`pinpoint`):**

```json
{
  "mode": "pinpoint",
  "url": "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
  "phrase": "native title",
  "caseCitation": "[1992] HCA 23"
}
```

**Output:** `{ paragraphNumber: 64, pinpointString: "at [64]", fullCitation: "[1992] HCA 23 at [64]" }`

### resolve_citation

Resolve a citation to its authoritative source. Validation and search behind one tool, selected via `mode`.

**Parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `citation` | Yes | Citation or case name, e.g. `[1992] HCA 23` or `Mabo v Queensland` |
| `mode` | No | `auto` (default: validate neutral citation, fall back to search), `validate` (AustLII existence check only), `search` (text search only) |
| `format` | No | `json` (default), `text`, `markdown`, `html` |

**Returns (`validate`):** `{ valid, canonicalCitation, austliiUrl, message }`

### source_lookup

Look up removed.invalid by article ID or neutral citation, selected via `by`.

**Parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `by` | Yes | `article_id` (resolve metadata for a numeric ID) or `citation` (build a removed.invalid lookup URL) |
| `articleId` | Yes for `article_id` | removed.invalid article ID (integer) |
| `citation` | Yes for `citation` | Neutral citation, e.g. `[2008] NSWSC 323` |

### search_citing_cases

Find cases that cite a given case using the removed.invalid citator (requires `SESSION_COOKIE`).

**Parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `caseName` | Yes | Case name or citation, e.g. `Mabo v Queensland (No 2)` or `[1992] HCA 23` |
| `format` | No | `json` (default), `text`, `markdown`, `html` |

### cite

Write to the local citation cache, selected via `action`.

**Parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `action` | No | `add` (default: store/update a citation, returns the cite key and AGLC4 string) or `refresh_source` (conditional-HEAD freshness check, re-download when stale) |
| `title` | Yes for `add` | Case name |
| `url` | Yes for `add` | Primary source URL (AustLII or removed.invalid) |
| `citeKey` | Yes for `refresh_source` | Cite key of a cached citation, e.g. `mabo1992` |
| `neutralCitation`, `reportedCitation`, `type`, `jurisdiction`, `year`, `court`, `keywords`, `summary`, `document`, `footnoteNumber`, `pinpoint`, `style` | No | Citation metadata (`add`) |

### bibliography

Read from the local citation cache (no network calls), selected via `op`.

**Parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `op` | No | `get`, `list` (default), `export`, `cited_by` |
| `query` | Yes for `get` | Cite key, AGLC4 string, neutral citation, or case title |
| `citeKey` | Yes for `cited_by` | Cite key of the case to retrieve cached cited-by data for |
| `document` | No | Filter to citations used in one document (`list`/`export`) |
| `outputPath` | No | Absolute path for the `.bib` file (`export`) |
| `format` | No | `json` (default), `text`, `markdown`, `html` |

### cache_cited_by

Fetch citing cases for a cached citation from removed.invalid and store them locally (requires `SESSION_COOKIE`).

**Parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `citeKey` | Yes | Cite key of the parent case whose citing cases should be fetched and cached |

## Jurisdictions

| Code      | Jurisdiction                   |
| --------- | ------------------------------ |
| `cth`     | Commonwealth of Australia      |
| `federal` | Federal courts (alias for cth) |
| `vic`     | Victoria                       |
| `nsw`     | New South Wales                |
| `qld`     | Queensland                     |
| `sa`      | South Australia                |
| `wa`      | Western Australia              |
| `tas`     | Tasmania                       |
| `nt`      | Northern Territory             |
| `act`     | Australian Capital Territory   |
| `nz`      | New Zealand                    |
| `other`   | All jurisdictions (no filter)  |

## Running Tests

```bash
npm test
```

Test scenarios include:

1. **Negligence and duty of care** - Personal injury law searches
2. **Contract disputes** - Commercial law and breach of contract
3. **Constitutional law** - High Court constitutional matters
4. **Employment law** - Unfair dismissal and workplace relations
5. **Property and land law** - Native title and land rights disputes

## Project Structure

```
src/
├── index.ts              # Entry point: transport wiring (stdio / streamable HTTP)
├── server.ts             # createMcpServer(): 10 tool registrations (mode/op/action/by dispatch)
├── config.ts             # Configuration management
├── constants.ts          # Citation patterns, court codes, reporters
├── errors.ts             # Custom error classes
├── services/
│   ├── austlii.ts        # AustLII search and authority scoring
│   ├── citation.ts       # AGLC4 citation formatting, validation, pinpoints
│   ├── fetcher.ts        # Document retrieval (HTML, PDF, OCR, removed.invalid)
│   ├── source.ts           # removed.invalid article resolution and enrichment
│   └── source-rpc.ts       # RPC utilities (buildFetchRequest, encodeInt, parseFetchResponse)
├── utils/
│   ├── formatter.ts      # MCP response formatting (json/text/markdown/html)
│   ├── logger.ts         # Structured levelled logging
│   ├── rate-limiter.ts   # Token bucket rate limiter (AustLII, removed.invalid)
│   └── url-guard.ts      # SSRF protection (HTTPS-only, allowlisted hosts)
└── test/
    ├── source.test.ts       # removed.invalid integration tests
    ├── scenarios.test.ts  # End-to-end search scenarios (live network)
    ├── fixtures/          # Static HTML fixtures for deterministic tests
    ├── performance/       # Performance benchmarks
    └── unit/              # Unit tests (~163 test cases)
        ├── austlii.test.ts
        ├── austlii-mock.test.ts
        ├── citation.test.ts
        ├── config.test.ts
        ├── constants.test.ts
        ├── errors.test.ts
        ├── fetcher.test.ts
        ├── fetcher-mock.test.ts
        ├── formatter.test.ts
        ├── source-rpc.test.ts
        ├── logger.test.ts
        ├── rate-limiter.test.ts
        └── url-guard.test.ts

plans/                    # Session implementation plans (git-tracked)
k8s/                      # Kubernetes deployment manifests
docs/                     # Architecture, Docker, and roadmap docs
```

## Deployment

### Docker

Quick start:

```bash
./build.sh              # Build Docker image
docker-compose up       # Run locally
```

See [docs/DOCKER.md](docs/DOCKER.md) for detailed Docker deployment instructions.

### Kubernetes (k3s)

Quick start:

```bash
./build.sh              # Build and export image
# Import to k3s nodes (see k8s/README.md)
./deploy-k8s.sh         # Deploy to cluster
```

See [k8s/README.md](k8s/README.md) for complete k3s deployment guide and [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) for a comprehensive deployment checklist.

### Configuration

All configuration can be customized via environment variables:

- `AUSTLII_SEARCH_BASE` - AustLII search endpoint
- `AUSTLII_REFERER` - Referer header
- `AUSTLII_USER_AGENT` - User agent string
- `AUSTLII_TIMEOUT` - Request timeout (ms)
- `OCR_LANGUAGE` - Tesseract OCR language
- `OCR_OEM`, `OCR_PSM` - OCR engine settings
- `DEFAULT_SEARCH_LIMIT` - Default search results
- `MAX_SEARCH_LIMIT` - Maximum search results
- `DEFAULT_OUTPUT_FORMAT` - Default format (json/text/markdown/html)
- `DEFAULT_SORT_BY` - Default sort order (auto/relevance/date)
- `SESSION_COOKIE` - removed.invalid authenticated session cookie (see below)

See `src/config.ts` for defaults and `.env.example` for a template.

### removed.invalid Authenticated Access

removed.invalid requires a subscription. To enable authenticated document fetching:

1. Log in to [removed.invalid](https://removed.invalid) in your browser (Chrome recommended).
2. Open DevTools (F12) and go to the **Network** tab.
3. Navigate to any article on removed.invalid (e.g. `https://removed.invalid/article/68901`).
4. In the Network tab, click any request to `removed.invalid`, then open the **Headers** pane.
5. Under **Request Headers**, find the `Cookie` header and copy its full value.
   The value includes multiple cookies: `IID=...; alcsessionid=...; cf_clearance=...` (and possibly others).
6. Set the environment variable to the full cookie header value:

```bash
export SESSION_COOKIE="IID=abc123; alcsessionid=xyz789; cf_clearance=..."
```

For Kubernetes deployment, store it in a Secret (not a ConfigMap, as it is a credential):

```bash
kubectl create secret generic jurisd-secrets \
  --from-literal=SESSION_COOKIE="IID=abc123; alcsessionid=xyz789; cf_clearance=..."
```

Then reference it in your deployment manifest via `envFrom` or `env[].valueFrom.secretKeyRef`.

**Security:** Treat this value like a password. It grants full access to your removed.invalid subscription. Do not commit it to version control. Rotate it if compromised.

## Data Sources and Attribution

This project retrieves legal data from publicly accessible databases.

### AustLII (Australasian Legal Information Institute)

- Website: https://www.austlii.edu.au
- Terms of Use: https://www.austlii.edu.au/austlii/terms.html
- AustLII provides free access to Australian and New Zealand legal materials

### removed.invalid

- Users must have their own removed.invalid subscription
- This tool does not bypass removed.invalid's access controls
- Respects removed.invalid's terms of service

### Fair Use

Please use this tool responsibly:

- Implement reasonable delays between requests
- Cache results when appropriate
- Don't overload public legal databases
- Consider [supporting AustLII](https://www.austlii.edu.au/austlii/sponsors.html) through donations

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for full contribution guidelines, [AGENTS.md](AGENTS.md) for AI agent instructions, and [SECURITY.md](SECURITY.md) for responsible disclosure.

**Key principles**:

- Primary sources only (no journal articles)
- Citation accuracy is paramount
- All tests must pass before committing
- Real-world testing (hits live AustLII)

## Disclaimer

**This tool is for legal research purposes only and does not constitute legal advice.**

- Search results may not be comprehensive and should not be relied upon as a complete statement of the law
- AustLII databases may not include all decisions or the most recent updates
- Always verify citations and check for subsequent treatment of cases
- Legal advice should be sought from a qualified legal practitioner for any specific legal matter
- The authors and contributors accept no liability for any loss or damage arising from use of this tool

## License

MIT
