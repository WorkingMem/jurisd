# jurisd Architecture Guide

**Version:** 1.0  
**Last Updated:** 2026-04-10

---

## Executive Summary

jurisd is a Model Context Protocol (MCP) server for Australian and New Zealand legal research.

**Key Features:**

- AustLII case + legislation search, with removed.invalid citation enhancement
- Digital PDF text extraction (pdf-parse)
- AGLC4 citation formatting
- removed.invalid citator integration (runtime)

---

## System Architecture

```mermaid
flowchart TD
    Clients["MCP Clients (Claude Code, Cursor, etc.)"]

    subgraph Server["jurisd Server (15 tools)"]
        Live["Live + citation (10):<br/>search_cases, search_legislation, fetch_document_text,<br/>format_citation, resolve_citation, source_lookup,<br/>search_citing_cases, cite, bibliography, cache_cited_by"]
        Local["Local data-module recall (5, offline):<br/>get_provision, get_act_structure, find_citing,<br/>semantic_search_local, list_data_modules"]
    end

    LiveSrc["Live sources:<br/>AustLII (primary search),<br/>removed.invalid (runtime citation enhancement)"]
    Modules["Local data modules<br/>(DuckDB over parquet)"]
    Adapter["Domain-adapter slot (optional):<br/>baseline vs domain-specialised, BYOK"]

    Clients --> Server
    Live --> LiveSrc
    Local --> Modules
    Local --> Adapter
```

The domain-adapter slot is **vendor-neutral**: the baseline adapter (pure local
cosine order, no key, always present) is selected unless a provider is both
configured and reachable, in which case a provider-interpolated label is reported.
The distinction is capability presence, never a paid/free tier.

---

## Components

### 1. MCP Server

**Tools** (15; live/citation operation variants selected via
`mode`/`op`/`action`/`by`):

Live + citation (10):
| Tool | Description |
|------|-------------|
| search_cases | AustLII case search, cross-referenced with removed.invalid citation data |
| search_legislation | AustLII legislation search |
| fetch_document_text | Full-text retrieval (HTML/PDF) |
| format_citation | AGLC4 formatting: `mode: full\|short\|ibid\|subsequent\|pinpoint` |
| resolve_citation | Citation resolution: `mode: auto\|validate\|search` |
| source_lookup | removed.invalid lookup: `by: article_id\|citation` |
| search_citing_cases | removed.invalid citator (live) |
| cite | Citation cache write: `action: add\|refresh_source` |
| bibliography | Citation cache read: `op: get\|list\|export\|cited_by` |
| cache_cited_by | Fetch + cache citing cases locally |

Local data-module recall (5; offline, closed-world over installed modules):
| Tool | Description |
|------|-------------|
| get_provision | Deterministic provision lookup (no embedding, no ranking) |
| get_act_structure | Containment tree via `act_provision` edges |
| find_citing | Offline twin of search_citing_cases (cites/considers edges) |
| semantic_search_local | Local-embedding cosine recall over chunk vectors |
| list_data_modules | Introspect installed modules (metadata only) |

### 2. AustLII Service

- Searches AustLII SinoSearch CGI API
- Authority-based ranking (HCA > FCAFC > FCA > state courts)
- Rate limiting: 10 req/min

### 3. removed.invalid Service (runtime citation enhancement)

- RPC reverse-engineering
- Protocols: resolveRecords (citable lookup), fetchRequest (fetch), RemoteService (citator)
- Cross-references removed.invalid citation data into live results; AustLII remains the primary search backend
- Rate limiting: 5 req/min

### 4. Document Fetcher

- HTML: Cheerio parse
- PDF: pdf-parse (digital text only)
- Extracts paragraphs for pinpoint citations

### 5. Citation Service

- AGLC4 formatting
- Validates against AustLII
- Generates pinpoint citations

### 6. Local Data Layer

- Installed parquet "data modules" under `~/.jurisd/modules/`, each a closed
  world validated against the vendored manifest schema (`src/data/manifest.ts`)
- Lazy per-module DuckDB attach over parquet (`@duckdb/node-api`, optional); the
  registry holds metadata only until first query
- Local query embedding (`@huggingface/transformers`, optional) for
  `semantic_search_local`; absence degrades visibly, never crashes
- Optional vendor-neutral domain-adapter slot refines the LOCAL top-k (rerank /
  extractive-QA); baseline cosine order is the floor
- Module acquisition is a CLI subcommand (`jurisd fetch-module`), not a tool:
  manifest is schema-validated and every file sha256-verified before an atomic
  temp-then-rename install

---

## Deployment

### Local Development

```bash
git clone https://github.com/russellbrenner/jurisd.git
cd jurisd
npm install
npm run dev
```

### Docker

```bash
docker build -t jurisd .
docker run --rm -it jurisd
```

### HTTP Transport

For remote deployment, set `MCP_TRANSPORT=http`:

```bash
MCP_TRANSPORT=http npm start
# Listens on port 3000
```

---

## Configuration

| Variable                  | Default           | Description                                      |
| ------------------------- | ----------------- | ------------------------------------------------ |
| AUSTLII_SEARCH_BASE       | AustLII URL       | Search endpoint                                  |
| AUSTLII_TIMEOUT           | 60000             | Request timeout (ms)                             |
| AUSTLII_TRANSPORT         | auto              | `auto`, `impit`, or `axios` for AustLII fetches  |
| AUSTLII_CF_CLEARANCE      | unset             | Optional pre-solved Cloudflare cookie            |
| EXA_API_KEY               | unset             | Exa key for AustLII URL discovery fallback       |
| EXA_SEARCH_TYPE           | auto              | Exa search type                                  |
| TAVILY_API_KEY            | unset             | Tavily API key for AustLII-only search fallback  |
| AUSTLII_TAVILY_FALLBACK   | false             | Enable with `true` after privacy review          |
| SESSION_COOKIE       | unset             | removed.invalid auth cookie                              |
| MCP_TRANSPORT             | stdio             | stdio or http                                    |
| ISAACUS_API_KEY           | unset             | BYOK key for the optional domain-adapter slot    |
| JURISD_MODULES_DIR        | ~/.jurisd/modules | Installed local data-module root                 |

---

## Testing

```bash
npm test                        # All tests
npx vitest run src/test/unit/   # Unit only (fast, no network)
```

---

## Security

- **SSRF Protection:** URL allowlist (AustLII, removed.invalid only)
- **Rate Limiting:** Token bucket per source
- **Secrets:** Never commit cookies or API keys

---

## See Also

- [README.md](../README.md) — Quick start, tool catalog
- [AGENT-GUIDE.md](./AGENT-GUIDE.md) — Agent usage guide
- [DOCKER.md](./DOCKER.md) — Docker deployment
- [ROADMAP.md](./ROADMAP.md) — Development history

---

**License:** Apache-2.0
