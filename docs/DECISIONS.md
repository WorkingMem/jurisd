# jurisd Decision Log

**Purpose:** Track architectural decisions without revealing internal infrastructure.

---

## Decision Records

### ADR-001: Dual-Source Search Architecture

**Date:** 2026-03-01  
**Status:** Accepted

**Context:** Legal research requires comprehensive search coverage. AustLII provides free access; jade.io offers premium curated content.

**Decision:** Query both AustLII and jade.io, merge results with deduplication by neutral citation.

**Consequences:**

- Positive: Better coverage, richer metadata
- Negative: Increased complexity, requires jade.io subscription for full functionality

---

### ADR-002: jade.io GWT-RPC Reverse Engineering

**Date:** 2026-03-03  
**Status:** Accepted

**Context:** jade.io has no public search API; uses GWT-RPC protocol.

**Decision:** Reverse-engineer GWT-RPC for programmatic access.

**Consequences:**

- Positive: Full feature access (search, citator)
- Negative: Strong names change on redeployment; requires maintenance

---

### ADR-003: OCR Fallback for Scanned PDFs

**Date:** 2026-03-05  
**Status:** Accepted

**Context:** Older judgments are scanned PDFs without embedded text.

**Decision:** Tesseract OCR fallback when PDF text <100 chars.

---

### ADR-004: AGLC4 Citation Formatting

**Date:** 2026-03-06  
**Status:** Accepted

**Context:** Australian legal writing requires AGLC4 format.

**Decision:** Native AGLC4 formatting, validation, pinpoint generation.

---

### ADR-005: Stateless MCP Server Design

**Date:** 2026-03-10  
**Status:** Accepted

**Decision:** No persistent storage. Caching/enrichment delegated to backend services.

**Pattern:** MCP server = API gateway; backend = inference + storage

---

### ADR-006: Rate Limiting

**Date:** 2026-03-12  
**Status:** Accepted

**Decision:** Token bucket: 10 req/min AustLII, 5 req/min jade.io.

---

### ADR-007: SSRF Protection

**Date:** 2026-03-12  
**Status:** Accepted

**Decision:** URL allowlist (AustLII, jade.io, official courts only).

---

### ADR-008: Secret Management

**Date:** 2026-03-15  
**Status:** Accepted

**Decision:** Secrets via environment variables or secure secret stores. Never commit to git.

---

### ADR-009: Separate Inference Layer

**Date:** 2026-03-11  
**Status:** Accepted

**Decision:** AI inference (Isaacus) is a separate service. jurisd calls via SDK or HTTP.

---

### ADR-010: User-Provided API Keys

**Date:** 2026-03-16  
**Status:** Accepted

**Decision:** Users provide their own API keys. Transparent pricing, no usage limits.

---

## Pending Decisions

### PND-001: Citation Graph Storage

**Options:** In-memory, PostgreSQL, or graph database.

**Status:** Under discussion

### PND-002: Generative Fallback

**Options:** No fallback, optional, or always-on for low-confidence QA.

**Status:** Under discussion

---

**Revision History:**

- 2026-04-10: Initial; ADR-001 through ADR-010 documented
