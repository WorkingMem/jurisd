# AusLaw MCP

Model Context Protocol (MCP) server for Australian and New Zealand legal research. Searches AustLII for case law and legislation, retrieves full-text judgements with paragraph numbers preserved, and supports OCR for scanned PDFs.

<a href="https://glama.ai/mcp/servers/@russellbrenner/auslaw-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@russellbrenner/auslaw-mcp/badge" alt="AusLaw MCP server" />
</a>

**Status**: ✅ Working MVP with intelligent search relevance

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
- ✅ **removed.invalid URL support**: Fetch document text from removed.invalid URLs (requires user access)
- ✅ **Paragraph preservation**: Keeps `[N]` paragraph numbers for pinpoint citations
- ✅ **Multiple formats**: JSON, text, markdown, or HTML output
- ✅ **Document retrieval**: Full text from HTML and PDF sources (AustLII, removed.invalid)
- ✅ **OCR support**: Tesseract OCR fallback for scanned PDFs

### Roadmap
- 🔶 **removed.invalid integration**: Partial support - users can provide removed.invalid URLs for document fetching
- 🔜 **removed.invalid search**: Pending API access from removed.invalid for search integration
- 🔜 **Page numbers**: Will extract page numbers from reported versions
- 🔜 **Authority ranking**: Will prioritise reported over unreported judgements

See [ROADMAP.md](docs/ROADMAP.md) for detailed development plans.

## Quick Start

### Local Development

```bash
git clone https://github.com/russellbrenner/auslaw-mcp.git
cd auslaw-mcp
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
docker build -t auslaw-mcp:latest .

# Run with Docker Compose
docker-compose up

# Or run directly
docker run -it --rm auslaw-mcp:latest
```

See [docs/DOCKER.md](docs/DOCKER.md) for detailed Docker deployment instructions.

### Kubernetes (k3s) Deployment

```bash
# Build and import image to k3s nodes
docker build -t auslaw-mcp:latest .
docker save auslaw-mcp:latest -o auslaw-mcp.tar

# Deploy to k3s cluster
kubectl apply -f k8s/
```

See [k8s/README.md](k8s/README.md) for complete Kubernetes deployment guide.

## MCP Registration
Configure your MCP-compatible client (eg. Claude Desktop, Cursor) to launch the compiled server.

For Claude Desktop, edit `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "auslaw-mcp": {
      "command": "node",
      "args": ["/path/to/auslaw-mcp/dist/index.js"]
    }
  }
}
```

Replace `/path/to/auslaw-mcp` with the actual path to your installation.

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
Fetch full text from a case or legislation URL. Supports HTML and PDF with OCR fallback.

**Parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | Yes | URL of the document (AustLII or removed.invalid) |
| `format` | No | `json` (default), `text`, `markdown`, `html` |

**Example:**
```json
{
  "url": "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html"
}
```

## Jurisdictions

| Code | Jurisdiction |
|------|-------------|
| `cth` | Commonwealth of Australia |
| `federal` | Federal courts (alias for cth) |
| `vic` | Victoria |
| `nsw` | New South Wales |
| `qld` | Queensland |
| `sa` | South Australia |
| `wa` | Western Australia |
| `tas` | Tasmania |
| `nt` | Northern Territory |
| `act` | Australian Capital Territory |
| `nz` | New Zealand |
| `other` | All jurisdictions (no filter) |

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
├── index.ts              # MCP server & tool registration
├── config.ts             # Configuration management
├── services/
│   ├── austlii.ts       # AustLII search integration
│   └── fetcher.ts       # Document text retrieval
├── utils/
│   └── formatter.ts     # Output formatting
└── test/
    └── scenarios.test.ts # Integration tests

k8s/
├── namespace.yaml        # Kubernetes namespace
├── configmap.yaml        # Configuration for k8s
├── deployment.yaml       # Deployment specification
├── service.yaml          # Service definition
└── README.md            # Kubernetes deployment guide

docs/
├── DOCKER.md            # Docker deployment guide
├── architecture.md      # Architecture documentation
└── ROADMAP.md          # Development roadmap
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

See [config.yaml](config.yaml) for defaults and `.env.example` for a template.

## Contributing

See [AGENTS.md](AGENTS.md) for AI agent instructions and development guidelines.

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