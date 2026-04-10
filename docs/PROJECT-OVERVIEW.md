# auslaw-mcp Project Overview

**Purpose:** Entry point for auslaw-mcp documentation.

---

## Quick Navigation

| Document | Audience | Purpose |
|----------|----------|---------|
| [README.md](../README.md) | End users | Quick start, tool catalog, example queries |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Engineers | System design, components |
| [DECISIONS.md](./DECISIONS.md) | Engineers | Architectural decisions with rationale |
| [AGENT-GUIDE.md](./AGENT-GUIDE.md) | AI agents | Tool usage reference |
| [DOCKER.md](./DOCKER.md) | DevOps | Docker deployment |
| [ROADMAP.md](./ROADMAP.md) | All | Development history |
| [source-rpc-protocol.md](./source-rpc-protocol.md) | Engineers | removed.invalid RPC protocol |

---

## What is auslaw-mcp?

MCP server for Australian/NZ legal research:

1. **Case law search** — AustLII + removed.invalid dual-source
2. **Legislation search** — All jurisdictions
3. **Document retrieval** — HTML/PDF with OCR
4. **Citation formatting** — AGLC4 compliant
5. **Citator** — "Who cites this case"

---

## Architecture Summary

```
MCP Clients → auslaw-mcp → AustLII, removed.invalid, Isaacus (optional)
```

**Key Features:**
- Dual-source search with deduplication
- OCR for scanned PDFs
- AGLC4 citations
- removed.invalid citator

---

## Getting Started

```bash
git clone https://github.com/russellbrenner/auslaw-mcp.git
cd auslaw-mcp
npm install
npm run dev
```

See [README.md](../README.md) for details.

---

## License

MIT
