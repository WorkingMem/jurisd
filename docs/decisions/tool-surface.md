# Decision Record: R5 Tool-Surface Consolidation

**Date:** 2026-06-12
**Status:** Accepted

## Context

jurisd exposed 18 MCP tools, one per operation. Tool-selection accuracy in MCP
clients degrades with both tool count and tool-name ambiguity, and the WS-E data
layer needs room for 5 additional recall tools under an 18-tool ceiling. An audit
of the surface found that several tools were variants of a single intent
(formatting a citation, resolving a citation, reading the citation cache) and
could be merged behind a discriminator parameter without losing capability.

## Decision

Consolidate the 18 tools to 10 base tools using `mode`/`op`/`action`/`by`
dispatch. Underlying service code is unchanged; this is a tool-registration and
handler reshape in `src/server.ts`.

### Consolidations

- **format_citation** absorbs `generate_pinpoint` + `format_short_citation` via
  `mode: full|short|ibid|subsequent|pinpoint`.
- **resolve_citation** (new name) absorbs `validate_citation` +
  `search_by_citation` via `mode: auto|validate|search`.
- **source_lookup** (new name) absorbs `resolve_source_article` +
  `source_citation_lookup` via `by: article_id|citation`.
- **cite** (write) absorbs `cache_citation` + `check_source_freshness` via
  `action: add|refresh_source`.
- **bibliography** (read) absorbs `get_cached_citation` + `list_bibliography` +
  `export_bibliography` + `get_cited_by` via `op: get|list|export|cited_by`.

### Unchanged

`search_legislation`, `search_cases`, `fetch_document_text`,
`search_citing_cases`, `cache_cited_by` (live-network write with a distinct
failure surface; stays standalone).

The audit considered keeping `check_source_freshness` standalone (11 base
tools); absorbing it into `cite` was chosen since freshness checking is a
cache-write concern with no independent intent.

The largest, lowest-risk win is the `bibliography` merge.

### WS-E additions stay dedicated

The 5 planned WS-E data-layer tools are NOT mode-merged into a super-tool:

- `get_provision` (highest-traffic deterministic lookup; a dedicated name aids
  agent selection)
- `semantic_search_local` (distinct intent + capability gate on jurisd
  embeddings)
- `find_citing` (local twin of live `search_citing_cases`; explicit source
  choice)
- `get_act_structure` (recursive-CTE structural read)
- `list_data_modules` (admin/introspection)

Rationale: recall tools map to crisp, frequent, distinct intents, so dedicated
names win. Mode-merging pays off only for orchestration operations
(`bibliography`) and the single "format a citation" intent.

Final surface: 10 base + 5 WS-E = 15, under the 18-tool ceiling.

## Migration

Pre-1.0: no aliases for old names (aliases would re-inflate the count). One
breaking cut, with an old-to-new mapping table in the CHANGELOG. Tool names
stay snake_case.

## Consequences

- Positive: smaller, less ambiguous tool surface; headroom for WS-E recall
  tools; orchestration intents grouped behind one name each.
- Negative: breaking change for any client configured against the old tool
  names; moded tools carry larger input schemas with per-mode required-field
  validation (`superRefine`) instead of schema-level `required`.
