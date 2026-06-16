# jurisd CLI/TUI legal reasoning workbench design

Date: 2026-06-16
Status: approved design, pending implementation plan
Scope: jurisd CLI, TUI, MCP adapter foundations, command contracts, help, completions, security conventions, and north-star architecture for local corpora, vector recall, graph traversal, provider enrichment, and source-backed legal reasoning.

## 1. Product stance

jurisd is a source-backed Australian legal research and provenance instrument over a governed command surface. It supports legal research, source verification and relationship tracing for human review. It is not a chatbot, oracle, AI companion or autonomous legal advice system.

The north star is a terminal workbench for legal reasoning, comparable in operating style to Claude Code, but over legal corpora rather than source code repositories.

Plain model:

1. Import legal sources, matter documents, PDFs, HTML, legislation, case law, notes, or source bundles.
2. Preserve originals in custody with content hashes and provenance.
3. Extract document structure, source spans, paragraphs, headings, provisions, citations, judges, parties, courts, and defined terms.
4. Create chunks and embeddings for source-backed semantic recall.
5. Build and query legal relationship data, including citation paths, source trails, authority trails, matter maps, and reviewable graph edges.
6. Trace every result, relationship, enrichment, and generated claim back to source spans or label it as proposed, unresolved, degraded, or rejected.
7. Let humans and agents search, inspect, trace, review, enrich, write, export, and maintain the local legal knowledge base.

Core invariant:

> No source span, no trusted legal claim.

Vector search is recall, not legal authority. Graph traversal is a map over stored relationships, not a proof of law. External enrichment is candidate generation unless accepted through deterministic gates or review.

## 2. WorkingMem terminology alignment

The design uses WorkingMem terminology where applicable.

Use:

- command contract registry with authority metadata
- typed command contract
- authority-aware execution service layer
- CLI adapter
- MCP adapter
- TUI adapter
- future local-server or web adapter
- renderer for output formats only
- source span
- source-span-backed result block
- source artifact
- provenance tracing
- legal relationship block
- relationship claim
- closed-world read
- review state
- Evidence Pack, only for externally verifiable proof bundles

Avoid or qualify:

- unqualified registry
- MCP renderer
- TUI renderer, where the TUI is interactive
- citation as the generic provenance anchor
- source text as the trust anchor
- unqualified authority
- unqualified verified
- user-facing numeric confidence as legal confidence
- same_source_as unless identity layers are defined
- free, premium, basic, or pro provider tier language

Canonical product sentence:

> jurisd is a source-backed Australian legal research and provenance instrument over a governed command surface. It supports legal research, source verification and relationship tracing for human review. It is not a chatbot, oracle, AI companion or autonomous legal advice system.

## 3. Command architecture

Commands are defined by stable typed command contracts. CLI, MCP, TUI, and future local-server or web surfaces are adapters over those contracts. Execution is routed through an authority-aware service layer that performs validation, capability checks, side-effect checks, provenance capture, review gating, audit recording, and typed result production.

Preferred architecture:

```text
Command contract registry with authority metadata
→ Authority-aware execution service layer
→ Application services
→ CLI / MCP / TUI / local-server adapters
→ Human / JSON / NDJSON / Plain / Markdown renderers
→ Generated help / completions / docs / tests
```

Internal command ids are stable identifiers. CLI commands, MCP tool names, and TUI labels are adapter-specific aliases.

Example mapping:

```text
command id: search.cases
CLI:        jurisd search cases
MCP:        search_cases
TUI:        Search cases
Docs:       /commands/search/cases
```

MCP names remain stable `snake_case`. CLI names use task-oriented command words. TUI labels are human-readable.

### 3.1 Command contract fields

Every public command contract must declare:

- stable command id
- aliases
- synopsis
- summary
- description
- arguments
- flags
- stdin mode
- output modes
- examples
- exit codes
- validation schema
- completion provider metadata
- MCP mapping, if exposed
- TUI metadata, if exposed
- docs anchor
- stability level
- side-effect class
- dangerousness
- auth, network, source, and cache requirements
- terminal safety policy
- path and URL policy
- capability gates
- result contract

Missing required metadata fails tests.

### 3.2 Adapter eligibility metadata

Each command contract must record adapter eligibility and side-effect metadata.

Example:

```yaml
command_id: search.cases
cli_alias: jurisd search cases
mcp_tool: search_cases
tui_label: Search cases
adapters:
  cli: true
  mcp: true
  tui: true
side_effect_class: read_only_query
confirmation_required: false
filesystem_write: false
network_write: false
admin_only: false
credential_dependent: false
capability_gates: []
result_contract: legal_search_results.v1
```

## 4. MCP exposure rule

MCP exposure is curated. Not every internal command becomes an MCP tool.

MCP tools are limited to stable, frequent, externally useful query and review intents. Variants should be consolidated behind `mode`, `op`, `action`, or `by` parameters where they share intent. Dedicated MCP tools are reserved for crisp, frequent, distinct intents.

Operator, install, update, fetch, destructive, filesystem-write, and network-write commands are CLI-only unless a later decision explicitly allows them under an authority contract.

Existing MCP tool names and schemas must remain compatible unless explicitly documented as a breaking change. Current 15 MCP tools stay stable during the first CLI/TUI foundation PR.

Safe future MCP workbench tools may include:

- `search_sources`
- `get_source_span`
- `trace_claim`
- `inspect_node`
- `query_graph_closed_world`
- `propose_edge`
- `review_item`
- `resolve_citation`
- `import_source`, only with authority and audit controls
- `corpus_status`
- `export_evidence_pack`

MCP must call the same application services as CLI and TUI. It must not bypass review, provenance, capability, or authority checks.

## 5. CLI product model

The CLI is workflow-shaped, not a raw MCP tool dump.

Recommended top-level groups:

```text
jurisd sources
jurisd corpus
jurisd search
jurisd graph
jurisd review
jurisd enrich
jurisd export
jurisd mcp
jurisd doctor
jurisd completion
jurisd tui
```

Useful aliases:

```text
jurisd import   -> jurisd sources import
jurisd trace    -> jurisd graph trace
jurisd inspect  -> object inspection
jurisd status   -> jurisd corpus status
```

Existing flat tool-parity commands should remain as compatibility aliases initially. Help should lead users toward the grouped workflow commands.

### 5.1 Help contract

Top-level help must be short, task-oriented, and example-driven. Per-command help must include:

- one-line purpose
- required arguments
- optional flags
- defaults
- accepted values
- examples
- output modes
- exit codes
- related commands
- failure examples
- security or source caveats where relevant

Help entry points:

```text
jurisd
jurisd help
jurisd help search
jurisd search --help
jurisd search cases --help
jurisd help examples
jurisd help outputs
jurisd help exit-codes
```

Generated reference is allowed. Guidance, tutorials, legal workflows, troubleshooting, and security model docs must be authored.

### 5.2 Output contract

Global output modes:

```text
--format human|json|ndjson|plain|markdown
--json
--plain
--no-color
--quiet
--verbose
--debug
--timeout
```

Rules:

- stdout is primary output only
- stderr is diagnostics and errors only
- JSON mode emits valid JSON only
- JSON and NDJSON contain no colour, progress bars, terminal decoration, or prose prefixes
- human output is not a parsing contract
- every machine output includes a schema version

Stable exit codes:

```text
0   success
1   general failure
2   usage or validation error
3   no results
4   source unavailable
5   auth failure
6   network failure
7   parse or citation resolution failure
8   partial success
9   unsafe operation refused
10  configuration error
11  internal error
130 interrupted
```

Errors must be actionable. They should explain what failed, expected values or shape, whether anything executed, and one concrete fix. Raw zod dumps and stack traces are debug-only.

## 6. TUI product model

The TUI is an agentic legal reasoning workbench, not a passive renderer and not a chatbot.

The TUI is an adapter and operating surface over the same command contracts and application services as the CLI and MCP.

Core areas:

- Sources
- Corpus
- Search
- Graph
- Review
- Enrich
- Exports
- Doctor

Core panes:

- corpus and source tree
- source text with highlighted spans
- search and recall results
- graph or path view
- inspector and provenance pane
- review queue
- reasoning trace
- status and degradation strip
- command palette

Plain action labels:

- Add sources
- Find related passages
- Trace this claim
- Show why this is linked
- Open source span
- Mark as accepted
- Mark as disputed
- Export evidence pack
- Check system health

### 6.1 Agentic TUI

The TUI includes a built-in research agent. Natural language is the control surface. Source-backed commands, provenance, review state, and typed result blocks are the execution surface.

The user can type:

```text
Find the main authorities on extinguishment of native title and show how they relate to Mabo.
```

The agent may plan and run governed commands:

1. identify or ask for active corpus
2. search lexical and semantic indexes
3. resolve citations
4. inspect source spans
5. traverse accepted graph edges
6. propose candidate relationships
7. show authority trails
8. ask before mutating graph or review state
9. export source-backed notes or Evidence Packs

The agent is not a separate backend. It operates through the command contract registry and authority-aware execution service.

Read-only operations may run automatically within the active corpus scope:

- local search
- semantic recall
- source-span inspection
- citation resolution
- accepted graph traversal
- provider capability checks
- provenance tracing
- source-backed summary of retrieved spans

Confirmation is required for:

- imports
- external network fetches not already configured as safe source providers
- enrichment jobs
- embedding or index rebuilds
- graph build, rebuild, repair, or mutation
- review-state changes
- exports
- native graph queries
- credentialed provider calls with cost or data-boundary implications

Agent plans must be visible. Running plans must be interruptible. Every agent action is recorded as command executions plus provenance or audit events where relevant.

### 6.2 TUI terminal behaviour

Default TUI preserves native terminal scrollback. It does not use alternate screen by default. Completed output is stable, selectable, and copy-friendly.

The TUI must honour:

- `NO_COLOR`
- `FORCE_COLOR`
- `TERM=dumb`
- CI environments
- screen-reader mode where supported
- narrow terminal widths
- keyboard-only operation

Colour never carries meaning alone. Use labels such as `OK`, `WARN`, `ERROR`, `SOURCE`, `CANCELLED`, `DEGRADED`, and `NEEDS REVIEW`.

## 7. Source, corpus, vector, and graph architecture

jurisd is built around a canonical source-backed corpus. Vector and graph systems are replaceable projections.

Plain architecture:

```text
SourceStore              raw custody
CorpusStore              canonical local truth
Parser/ExtractorProvider document-interior extraction
VectorIndexProvider      semantic recall
GraphProvider            graph projection and traversal
LegalDomainProvider      enrichment, embeddings, rerank, extractive QA, classification
ReviewService            review-state transitions
ProvenanceService        event and audit trail
TraceService             explain why a result exists
ExportService            Evidence Packs and outputs
CLI / TUI / MCP          adapters over the same services
```

Key rule:

```text
CorpusStore = truth
VectorIndexProvider = recall accelerator
GraphProvider = traversal accelerator
LegalDomainProvider = enrichment and candidate generator
```

### 7.1 SourceSpan invariant

`SourceSpan` is the mandatory join key across the system.

A source span connects:

- source document
- document version
- paragraph, provision, heading, page, or pinpoint
- chunk
- embedding
- vector hit
- graph node
- graph edge
- citation relationship
- extracted fact
- enrichment result
- review item
- generated answer fragment
- Evidence Pack entry
- provenance event

Every legal assertion is either traceable to source spans or explicitly marked as proposed, unresolved, inferred, degraded, or rejected.

### 7.2 Canonical local data model

Minimum north-star concepts:

- corpus
- source_document
- document_version
- source_blob
- source_span
- segment
- chunk
- chunk_span
- embedding_job
- embedding_record
- entity
- citation
- relationship
- graph_node
- graph_edge
- review_item
- provenance_event
- audit_event
- import_job
- enrichment_job
- provider_capability
- unmatched_citation
- export_bundle

The first CLI/TUI foundation PR does not need to implement this model. It must avoid architectural choices that block it.

### 7.3 Local and production storage direction

Preferred local direction, subject to spikes:

- DuckDB as local analytical substrate where stable and packageable
- DuckPGQ as preferred local graph-query candidate, subject to maturity and packaging verification
- SQLite adjacency tables as safe fallback baseline
- sqlite-vec, DuckDB vector extension, or local pgvector profile for vector recall, selected by verification

Production direction:

- object storage or CAS for source custody
- PostgreSQL for canonical store
- pgvector-class retrieval by default
- graph backend behind GraphProvider
- queue workers for parse, embed, graph, enrichment, and export jobs
- tenant, matter, classification, and compartment boundaries
- audit streams

No specialised vector database or graph service becomes mandatory until measured requirements justify it.

### 7.4 GraphProvider

GraphProvider owns graph projection and traversal, not canonical legal truth.

Required operations:

- upsert_node
- upsert_edge
- get_node
- get_edge
- neighbours
- paths
- subgraph
- temporal_as_of
- explain_path
- closed_world_query
- capabilities
- health
- degradation

Potential backends:

- DuckDB plus DuckPGQ
- LadybugDB
- SQLite adjacency tables
- PostgreSQL adjacency tables
- FalkorDB
- Graphiti
- Neo4j
- RDF/SPARQL backend
- production custom backend

DuckDB plus DuckPGQ is the leading local graph-query candidate because it aligns with embedded analytics, Parquet data modules, graph-over-table querying, and export workflows. LadybugDB is a candidate embedded property-graph backend and likely Kuzu successor, subject to verification. Graphiti is a candidate temporal graph-memory provider, not the architecture.

### 7.5 Graph query language

Do not make Cypher the canonical internal query language.

Use three layers:

1. guided commands for users and agents
2. portable typed graph query contract for internals, TUI, MCP, and tests
3. native backend query for expert mode

Guided commands:

```text
jurisd graph neighbours <node>
jurisd graph path <from> <to>
jurisd graph trace <claim-or-node>
jurisd graph inspect <node-or-edge>
jurisd graph subgraph <node>
jurisd graph as-of <date>
```

Native expert mode:

```text
jurisd graph query --language pgq '...'
jurisd graph query --language cypher '...'
jurisd graph query --language sparql '...'
```

Native query remains policy-wrapped. It must not bypass corpus scope, review-state policy, closed-world mode, time slicing, source-span requirements, or audit controls.

### 7.6 Closed-world graph reads

Graph reads used for legal reasoning are closed-world by default.

A graph query is scoped by:

- corpus
- matter, where applicable
- compartment or classification
- review-state policy
- time slice
- permitted edge types
- provider capability state
- degradation state

If no edge is stored, jurisd reports that no stored relationship was found in the current graph. It must not imply that the relationship is false in law.

Inferred or provider-proposed edges are candidates until reviewed.

### 7.7 Vector search

Vector search is semantic source recall, not authority.

A vector or hybrid hit returns:

- chunk_id
- source_span_ids
- document_id
- document_version_id
- corpus_id
- citation or pinpoint
- snippet
- vector score
- lexical score, if hybrid
- rerank score, if reranked
- embedding provider
- embedding model
- source hash
- review state
- classification or compartment
- degradation flags

The user-facing label should be “Find related source passages”, not “ask the vector database”.

## 8. Isaacus, ILDGS, Blackstone Graph, and provider pluggability

jurisd is Isaacus-aligned by default and provider-pluggable by contract.

Isaacus alignment is a first-class design constraint because Isaacus/Kanon appears to be the strongest Australian legal-domain provider path. That alignment must not become hard coupling.

### 8.1 Legal-domain provider capabilities

A LegalDomainProvider may supply:

- document-interior enrichment
- entity extraction
- legal classification
- embeddings
- reranking
- extractive Q&A
- relationship extraction
- world-layer entity or relationship mapping
- graph traversal or graph service access

Isaacus may provide several of these in future. Self-hosted legal models, general embeddings, local deterministic parsers, and production graph services must remain valid alternatives.

### 8.2 Layer model

```text
Document-interior layer:
  ILDGS-compatible spans, segments, cross-references, external-document mentions

World layer:
  Blackstone Graph-compatible legal and real-world entity taxonomy where verified

jurisd trust envelope:
  source span, provenance, review state, degradation, audit, correction path

Provider/backend layer:
  Isaacus API/MCP, self-hosted models, local data modules, Graphiti, DuckDB, production graph backend
```

### 8.3 Provider schema namespacing

Provider-specific fields are namespaced and versioned:

```ts
providerSchema: {
  provider: "isaacus";
  schema: "ildgs" | "blackstone-graph";
  version: string;
  type: string;
}
```

jurisd should use ILDGS and Blackstone-compatible terminology where schemas are available and verified. Do not invent competing legal ontology names where a verified provider term exists. Add local provenance and review metadata by wrapping provider terms, not by renaming the legal concept.

### 8.4 Provider labels

Use capability labels:

- baseline
- Isaacus-enhanced
- self-hosted legal model
- domain-specialised
- provider-unavailable
- capability-missing

Do not use free, premium, basic, or pro as legal capability language.

### 8.5 Capability gates

No command may require Isaacus unless explicitly labelled Isaacus-required. Commands declare capability gates, for example `requires: relationshipExtraction`.

If a capability is absent, return typed `capability_missing`, not silent fallback.

## 9. Legal relationship blocks

Use “legal relationship blocks”, not “citation/provision relationship graph blocks”.

Legal relationship blocks represent source-span-backed relationship claims between legal sources, provisions, documents, facts, issues, arguments, parties, courts, or source spans.

Every node and edge must carry:

- provenance
- evidence or source span where available
- extraction method
- confidence or corroboration state
- review state
- correction path

### 9.1 Extract then resolve

Extract then resolve.

Extracted mentions, citations, provisions, pinpoints, treatment strings, and cross-references are captured first. Resolution to canonical legal entities occurs in a separate audited step. Unresolved, ambiguous, malformed, unsupported-scheme, and no-match outcomes are first-class typed results. They must not be guessed, silently dropped, or converted into asserted relationships.

### 9.2 Relationship layers

Citation/document graph:

- cites
- considers
- cited_by as inverse query projection, not usually a stored edge

Legal treatment graph:

- applied
- followed
- not_followed
- distinguished
- approved
- overruled
- interpreted
- applies_authority, if using normalised canonical labels

Matter/fact graph:

- supports
- contradicts
- mentions
- occurred_before
- filed_in

Structure graph:

- contains
- part_of
- act_provision
- internal_crossref
- has_source_span

Legal treatment edges must retain the raw upstream treatment string where available. Editorial-grade treatment signals must be provider-derived, rule-derived, or human-reviewed before accepted use.

## 10. Typed result blocks and renderers

Handlers return typed result blocks, not opaque strings.

Renderers are output projections over typed result blocks. Renderers may format, order, hide, or summarise fields according to output mode, but must not invent confidence, alter provenance, collapse review state, or change command semantics.

Renderers:

- human
- json
- ndjson
- plain
- markdown

MCP is an adapter, not a renderer. TUI is an interactive adapter and research surface, not merely a renderer.

### 10.1 Required result block envelope

Legal result blocks should carry, where available:

- command_id
- result_id
- block_type
- generated_vs_source
- source_kind
- provider
- module_name
- module_version
- snapshot_date
- observed_at
- retrieved_at
- source_url
- content_hash
- span_locator
- char_start
- char_end
- pinpoint
- extraction_or_query_method
- confidence_label
- corroboration_state
- review_state
- provenance_event_id
- audit_event_id
- correction_path
- degradation_state
- degradation_note

Legal result blocks must carry provenance sufficient to trace the result to a source span, provider record, module version, or explicit degraded/refused state.

## 11. Review, confidence, and generated content

Review states:

- raw
- extracted
- proposed
- needs_review
- accepted
- corrected
- rejected
- disputed
- superseded
- stale
- quarantined
- unresolved

MVP may begin with:

- proposed
- accepted
- rejected
- disputed
- superseded
- unresolved

Confidence/corroboration terms:

- confidence_label
- confidence_band
- corroboration_state
- needs_review
- low_confidence_extraction
- single_source_inference
- multi_source_corroborated
- conflicting_evidence
- primary_source_confirmed

Numeric confidence is not shown as legal confidence by default. Numeric values may appear only when they are explicitly retrieval scores, deterministic facet scores, or calibrated metrics with documented semantics.

Generated summaries, answers, tags, relationship edges, extracted citations, and graph mutations are proposals unless accepted by deterministic gates or review. Generated output is not verified output. Source-backed does not mean legally correct.

## 12. Security, authority, and mutation boundaries

Every command declares a side-effect class:

- read_only_query
- local_metadata_read
- network_read
- credential_dependent_read
- corpus_write
- graph_write
- review_state_write
- export_write
- filesystem_write
- network_write
- destructive_admin

The authority-aware execution service enforces:

- command schema validation
- active corpus or matter scope
- permitted adapters
- side-effect class
- capability gates
- credential gates
- confirmation requirements
- review-state policy
- source-span requirement
- audit and provenance event creation

### 12.1 Confirmation rules

No confirmation needed for local read-only search, source-span inspection, accepted graph traversal, provenance tracing, or doctor/capability checks.

Confirmation required for imports, external network fetches, enrichment jobs, embedding or index rebuilds, graph build/rebuild/repair, review-state changes, exports, native graph queries, credentialed provider calls with cost or data-boundary implications, and destructive/admin operations.

### 12.2 Terminal safety

All untrusted text is hostile display input:

- source text
- provider responses
- case names
- court names
- upstream errors
- URLs
- filenames
- generated summaries

Renderers must strip or neutralise ANSI escapes, OSC hyperlinks, BEL, carriage returns, terminal title changes, bidi controls, and unsafe control characters. JSON and NDJSON contain no terminal decoration.

### 12.3 Credential rules

Credentials are configuration secrets.

They must never appear in command arguments, logs, TUI transcript, MCP result metadata, Evidence Packs, generated docs/examples, or debug output except in redacted form.

JADE session cookies, Isaacus keys, provider keys, and graph backend credentials are credential-dependent capability gates, not product tiers.

## 13. Evidence Packs and exports

Evidence Packs are externally verifiable export bundles with proof material. Ordinary CLI/TUI/MCP responses are typed result blocks with provenance metadata, not Evidence Packs.

An Evidence Pack contains:

- source spans
- hashes or content identifiers
- document versions
- graph nodes and edges used
- review decisions
- provenance events
- provider and model versions
- degradation notes
- command and audit events

An Evidence Pack proves what the system used, which sources were present, which policy and review state existed, and how an output was produced. It does not prove that a legal conclusion is correct.

## 14. Shell completions

Completions are generated from command metadata and trusted static values.

Required shells:

- bash
- zsh
- fish
- PowerShell, if practical in the same PR, otherwise staged explicitly

Completions must not perform network calls, execute tools, inspect untrusted project files, evaluate user-controlled text, or generate shell fragments from untrusted data.

Shell-specific escaping tests must cover quotes, whitespace, newlines, command substitutions, dollar expansions, backticks, leading dashes, ANSI escapes, OSC sequences, and control characters.

Completion install should print instructions or completion script content. It must not edit shell rc files by default.

## 15. Documentation and contributor conventions

Documentation is split into authored guidance and generated reference.

Authored docs:

- getting started
- legal research workflows
- CLI concepts
- TUI workflow
- MCP integration
- config and cache
- source custody and provenance model
- security model
- troubleshooting
- migration notes

Generated docs:

- command reference
- option reference
- JSON schemas
- MCP tool reference
- completions docs
- registry coverage tables

Generated sections must have deterministic ordering and visible generated notices. CI must fail when generated docs or completions are stale.

`AGENTS.md` should include:

- project purpose
- architecture map
- generated-file rules
- required tests
- security constraints
- docs rules
- review standards
- anti-slop rules
- how to add a command once

`CONTRIBUTING.md` should include:

- local setup
- test commands
- registry change process
- docs generation
- snapshot review
- security review triggers
- changelog fragment rules
- PR checklist

## 16. First PR scope

The first PR ships foundations only.

Deliver:

1. Repo conventions: `AGENTS.md`, strengthened `CONTRIBUTING.md`, rules for command contracts, generated docs, tests, security, and anti-slop examples.
2. Command contract architecture: command contract registry with authority metadata, adapter metadata, side-effect classification, capability gates, result contract hooks, registry coverage tests.
3. MCP compatibility preservation: existing 15 MCP tools remain stable, MCP names stay `snake_case`, no operator/admin commands exposed over MCP by default, compatibility tests prove behaviour is not broken.
4. CLI foundation: grouped command UX, compatibility aliases for existing flat commands, per-command help, global help topics, stable exit codes, stdout/stderr rules, `--json`, `--plain`, `--no-color`, `--debug`, actionable errors.
5. Shell completions: bash, zsh, fish, and PowerShell if practical, generated from metadata with shell-safe escaping tests.
6. TUI foundation: `jurisd tui`, command palette, transcript/composer layout, slash commands, minimal natural-language planning boundary, and future pane placeholders.
7. Docs: authored CLI guide, authored TUI guide, generated command reference, completion install docs, security and authority docs, architecture/north-star section.
8. Security review artefact: committed checklist/report covering terminal injection, no-shell invariant, completion injection, credential redaction, MCP exposure, and authority boundaries.

Explicitly do not build in the first PR:

- full CorpusStore
- DuckDB/DuckPGQ integration
- LadybugDB integration
- Graphiti integration
- vector indexing
- source import pipeline
- Evidence Pack export
- Isaacus provider integration
- full agentic planner
- graph visualisation
- review queue persistence

The first PR must make room for those features without pretending to ship them.

## 17. Staging after the first PR

Recommended stages:

1. Source custody and CorpusStore.
2. Parser/source spans and document-interior extraction.
3. Lexical and semantic recall.
4. GraphProvider with DuckDB/DuckPGQ or adjacency backend spike.
5. Review workflow.
6. Agentic TUI workbench.
7. Evidence Pack export.
8. MCP workbench tools.
9. Isaacus and self-hosted provider adapters.
10. Advanced graph and vector backends.

## 18. Acceptance criteria for the first PR

The first PR is acceptable only if:

- command metadata is not duplicated by hand across MCP, CLI, TUI, docs, and completions
- adding a command without required metadata fails tests
- existing MCP tool names and schemas remain compatible
- CLI help is useful, not schema-dump prose
- CLI errors are actionable
- stdout/stderr behaviour is documented and tested
- completions are deterministic and shell-safe
- TUI starts and exposes command palette/help
- docs explain the north-star architecture without claiming v1 has all of it
- security review is committed
- full test, lint, and build pass

## 19. Open verification items

Before implementation of later graph/vector/provider stages, verify with current external research:

- DuckDB + DuckPGQ packaging, TypeScript integration, maturity, persistence, and offline extension story
- LadybugDB packaging, licence, persistence, TypeScript integration, and project maturity
- Graphiti backend support, temporal semantics, provenance model, licensing, and operational maturity
- sqlite-vec, DuckDB vector extensions, pgvector, pgvectorscale, VectorChord, LanceDB, Qdrant, and Weaviate trade-offs
- Isaacus/Kanon Embedder, Reranker, Enricher, ILDGS, Blackstone Graph schema, access, licence, and Australian coverage
- Docling, OCR, paragraph-preserving legal parsers, LegalDocML/Akoma Ntoso, and citation resolvers
- terminal framework suitability for the TUI workbench model
- MCP patterns for scoped, provenance-bearing, capability-aware tools

## 20. Design decisions summary

- jurisd is a terminal legal reasoning workbench, not a chatbot.
- command contracts are the product contract.
- CLI, MCP, TUI, and future local-server/web surfaces are adapters.
- renderers are output formats only.
- CorpusStore is truth.
- SourceSpan is mandatory.
- vector search is recall, not authority.
- graph reads are closed-world by default.
- LegalDomainProvider and GraphProvider are separate.
- Isaacus alignment is strategic but provider-pluggable.
- DuckDB + DuckPGQ is the leading local graph-query candidate, subject to verification.
- Graphiti and FalkorDB remain provider candidates, not architecture.
- agentic TUI is command-governed and authority-aware.
- Evidence Packs prove process and sources, not legal correctness.
