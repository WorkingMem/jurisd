# jurisd CLI/TUI legal reasoning workbench design

Date: 2026-06-16
Status: approved design, remediated after adversarial review, pending implementation plan
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

Offline operation is a first-class requirement for local corpora. Local search, source-span inspection, accepted graph traversal, provenance tracing, and review of already-imported material must work without network access. Provider-backed enrichment, external fetches, remote embeddings, and credentialed services are optional capabilities. When unavailable, commands return typed `capability_missing` or `provider_unavailable` results rather than silently degrading into weaker claims.

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

Every public command contract must declare required, defaulted, and adapter-conditional metadata.

Required for every public command:

- stable command id
- synopsis
- summary
- arguments
- flags
- stdin mode
- output modes
- exit codes
- validation schema
- stability level
- side-effect class
- dangerousness
- auth, network, source, and cache requirements
- terminal safety policy
- path and URL policy
- capability gates
- result contract

Adapter-conditional metadata is required only where the adapter is enabled:

- aliases
- completion provider metadata
- MCP mapping, if exposed
- TUI metadata, if exposed
- docs anchor
- examples

Defaultable fields must still resolve to explicit values in the generated contract. Missing required metadata fails tests. Missing adapter-conditional metadata fails tests only when that adapter is enabled for the command.

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

The compatibility set must be enumerated in a generated or committed MCP compatibility reference before implementation starts. The reference must list each existing tool name, schema version or schema hash, result contract, and compatibility test. The spec does not rely on memory of the current 15 tools.

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

#### 6.1.1 Agent architecture boundary

The agentic TUI is implemented as an orchestration layer over command contracts, not as an unrestricted tool runner.

Minimum components:

- `AgentPlanner`, converts user intent into a typed plan made only of known command ids and typed arguments.
- `AgentContextAssembler`, selects source spans, prior command results, corpus scope, graph paths, and review state for planner context.
- `AgentExecutor`, dispatches approved plan steps through the authority-aware execution service.
- `AgentStateStore`, records plans, step state, interruptions, partial results, and resumability metadata.
- `AgentProvider`, supplies model-backed or rule-backed planning. Provider output is untrusted until validated against the command contract registry.

Agent plans are typed data, not prose. A plan step cannot execute unless its command id exists, its arguments validate, its adapter is permitted, and its side-effect class passes authority checks.

The first foundation PR must not implement a full natural-language planner. It may include only the UI and contract seams needed for a later planner.

#### 6.1.2 Agent failure and interruption rules

If a plan step fails, the agent must classify the failure as validation error, no results, source unavailable, capability missing, auth failure, network failure, unsafe operation refused, or internal error.

The agent may continue only where the plan declares the failed step as optional. Otherwise it must stop, show partial results, and ask for user direction.

Interrupting a running plan cancels pending steps, requests cancellation of active steps where supported, preserves completed result blocks, and records an audit or transcript event.

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

The TUI has two display modes.

Default inline mode preserves native terminal scrollback. Completed output is stable, selectable, and copy-friendly.

Future full-workbench mode may use alternate screen for multi-pane interaction, provided it can export or print a stable transcript of completed commands and reasoning traces. The first TUI foundation must not assume that all interfaces require alternate screen.

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

#### 7.1.1 Minimum SourceSpan schema

A `SourceSpan` is immutable and belongs to one document version.

Minimum fields:

```ts
type SourceSpan = {
  span_id: string;
  corpus_id: string;
  source_document_id: string;
  document_version_id: string;
  source_blob_id?: string;
  span_type:
    | "document"
    | "page"
    | "paragraph"
    | "heading"
    | "provision"
    | "schedule"
    | "clause"
    | "citation"
    | "pinpoint"
    | "selection"
    | "generated_reference";
  locator_type: "char_range" | "page" | "paragraph" | "provision" | "xpath" | "external";
  locator_value: string;
  char_start?: number;
  char_end?: number;
  page_start?: number;
  page_end?: number;
  parent_span_id?: string;
  content_hash?: string;
  created_at: string;
  supersedes_span_id?: string;
};
```

Rules:

- spans may overlap
- nested spans use `parent_span_id`
- document changes create a new `document_version_id` and new spans
- old spans are preserved and may be marked superseded through review or provenance metadata
- cross-document relationships are graph edges or relationship claims, not single spans
- inferred relationship claims may reference multiple source spans and must be marked `inferred`, `proposed`, or `needs_review` unless accepted by deterministic gates or review

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
- DuckDB plus a verified graph-query extension or graph-over-table approach as a primary spike candidate, subject to maturity, packaging, TypeScript integration, persistence, offline extension loading, and licence verification
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

- DuckDB plus a verified graph-query extension or graph-over-table approach
- Kuzu, only if maintenance status and packaging are acceptable
- LadybugDB, only after project identity and maturity are verified
- SQLite adjacency tables
- PostgreSQL adjacency tables
- FalkorDB
- Graphiti
- Neo4j
- RDF/SPARQL backend
- production custom backend

DuckDB plus a verified graph-query extension or graph-over-table approach is a primary spike candidate because it may align with embedded analytics, Parquet data modules, graph-over-table querying, and export workflows. It is not selected until packaging, TypeScript integration, persistence, offline extension loading, and licence are verified.

Kuzu, SQLite adjacency tables, PostgreSQL adjacency tables, FalkorDB, RDF/SPARQL backends, and other embedded or service-backed graph systems remain candidates behind `GraphProvider`.

LadybugDB must not be treated as a candidate until its project identity, repository, licence, maintenance status, persistence model, and TypeScript integration are verified.

Graphiti is a candidate temporal graph-memory backend behind `GraphProvider`, not the architecture and not a substitute for the CorpusStore.

GraphProvider backend selection criteria must include:

- source-span preservation
- review-state filtering
- closed-world scope filtering
- temporal filtering, where claimed
- efficient predicate pushdown for corpus, matter, compartment, review state, edge type, and time slice
- local/offline operation, where required
- TypeScript integration
- packaging and installation complexity
- persistence and backup model
- licence and project maturity

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

Native expert mode is backend-dependent:

```text
jurisd graph query --language <backend-supported-language> '...'
```

Examples may include `pgq`, `cypher`, or `sparql` only when the configured backend supports that language. Native query support is not a promise that all graph backends or all languages are available.

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

### 11.1 MVP review state transitions

MVP valid transitions:

| From       | To         | Notes                                                               |
| ---------- | ---------- | ------------------------------------------------------------------- |
| proposed   | accepted   | reviewer accepts the claim or relationship for current corpus scope |
| proposed   | rejected   | reviewer rejects the claim or relationship                          |
| proposed   | disputed   | reviewer records conflict or unresolved disagreement                |
| proposed   | unresolved | reviewer cannot resolve with current sources                        |
| accepted   | disputed   | later evidence or reviewer challenge                                |
| accepted   | superseded | newer source, correction, or replacement                            |
| rejected   | disputed   | reviewer challenge or new evidence                                  |
| rejected   | superseded | replaced by corrected extraction or relationship                    |
| disputed   | accepted   | dispute resolved in favour                                          |
| disputed   | rejected   | dispute resolved against                                            |
| disputed   | unresolved | insufficient source material                                        |
| unresolved | proposed   | new extraction, source, or provider result reopens item             |
| unresolved | rejected   | enough evidence to reject                                           |
| superseded | proposed   | only by creating a new review item or corrected successor           |

Every transition records:

- review item id
- from state
- to state
- actor or system actor
- reason, where supplied
- timestamp
- source spans or result ids considered
- audit or provenance event id

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

SOURCE session cookies, Isaacus keys, provider keys, and graph backend credentials are credential-dependent capability gates, not product tiers.

## 13. Evidence Packs and exports

Evidence Packs are externally verifiable export bundles with proof material. Ordinary CLI/TUI/MCP responses are typed result blocks with provenance metadata, not Evidence Packs.

Every command returns typed result blocks unless it explicitly invokes export behaviour. Evidence Packs are created only by explicit export commands, for example `jurisd export evidence-pack`, or by a clearly named future flag. Ordinary search, graph, review, and MCP responses are not Evidence Packs.

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

The expected Evidence Pack shape is a directory or zip bundle containing at minimum:

```text
manifest.json
sources/
spans/
graph/
review/
provenance/
audit/
README.md
```

`manifest.json` records bundle schema version, source hashes, included commands, provider versions, degradation notes, and verification metadata. Full schema is deferred to the Evidence Pack stage.

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

## 16. Foundation PR staging

The foundation work is split into reviewable PRs. Each PR must be independently mergeable and must not claim to ship later-stage corpus, graph, vector, provider, or agentic capabilities.

### 16.1 Foundation PR 1: command contracts, CLI skeleton, and MCP compatibility

Deliver:

1. Repo conventions: `AGENTS.md`, strengthened `CONTRIBUTING.md`, generated-file rules, required tests, security constraints, docs rules, review standards, anti-slop rules, and how to add a command once.
2. Command contract architecture: command contract registry with authority metadata, adapter metadata, side-effect classification, capability gates, result contract hooks, and registry coverage tests.
3. MCP compatibility preservation: existing MCP tools remain stable, MCP names stay `snake_case`, no operator/admin commands exposed over MCP by default, and compatibility tests prove behaviour is not broken.
4. CLI foundation: grouped command UX skeleton, compatibility aliases for existing flat commands, per-command help shape, global help topics, stable exit codes, stdout/stderr rules, `--json`, `--plain`, `--no-color`, `--debug`, and actionable error shape.
5. Docs skeleton: authored CLI guide outline, generated command reference pipeline, and security/authority documentation outline.
6. Security checklist: committed checklist covering terminal injection, no-shell invariant, credential redaction, MCP exposure, and authority boundaries.

Explicitly do not build in PR 1:

- full CorpusStore
- source import pipeline
- vector indexing
- graph backend integration
- shell completion generation beyond command metadata seams
- full TUI
- natural-language planner
- Evidence Pack export
- Isaacus provider integration

### 16.2 Foundation PR 2: completions, generated docs, and security hardening

Deliver:

1. bash, zsh, fish completions, and PowerShell if practical, generated from metadata
2. shell-safe escaping tests
3. generated command reference
4. completion install docs
5. stale generated-doc and completion checks
6. expanded security review artefact

### 16.3 Foundation PR 3: TUI scaffold

Deliver:

1. `jurisd tui` entry point
2. selected terminal framework
3. command palette over command contracts
4. transcript/composer layout
5. slash-command dispatch to governed command contracts
6. future pane placeholders
7. no full natural-language planner

### 16.4 Later PR: agentic TUI

The agentic TUI planner is implemented only after the planner architecture, command constraints, context assembly, failure handling, provider boundaries, and audit model are designed and tested.

## 17. Staging after foundation PRs

Recommended stages:

1. Source custody and CorpusStore.
2. Parser/source spans and document-interior extraction.
3. Lexical and semantic recall.
4. GraphProvider with DuckDB-backed graph-over-table or adjacency backend spike.
5. Review workflow.
6. TUI scaffold and command-palette workbench.
7. Agentic TUI planner and governed research workflows.
8. Evidence Pack export.
9. MCP workbench tools.
10. Isaacus and self-hosted provider adapters.
11. Advanced graph and vector backends.

## 18. Acceptance criteria for Foundation PR 1

Foundation PR 1 is acceptable only if:

- command metadata is not duplicated by hand across MCP, CLI, docs, and future adapter seams
- adding a command without required metadata fails tests
- existing MCP tool names and schemas remain compatible
- the current MCP compatibility set is enumerated in a committed or generated reference
- CLI help shape is useful, not schema-dump prose
- CLI errors are actionable
- stdout/stderr behaviour is documented and tested
- docs explain the north-star architecture without claiming v1 has all of it
- security checklist is committed
- full test, lint, and build pass

## 19. Open verification items

Before implementation of later graph/vector/provider stages, verify with current external research:

- DuckDB graph-query options, including whether DuckPGQ or any similarly named project is a DuckDB extension, PostgreSQL extension, standalone project, or unsuitable; verify packaging, TypeScript integration, maturity, persistence, offline extension loading, and licence
- Kuzu, SQLite adjacency tables, PostgreSQL adjacency tables, FalkorDB, RDF/SPARQL backends, and any proposed LadybugDB candidate; verify project identity, licence, persistence, TypeScript integration, local/offline operation, and project maturity
- Graphiti backend support, temporal semantics, provenance model, licensing, and operational maturity
- sqlite-vec, DuckDB vector extensions, pgvector, pgvectorscale, VectorChord, LanceDB, Qdrant, and Weaviate trade-offs
- Isaacus/Kanon Embedder, Reranker, Enricher, ILDGS, Blackstone Graph schema, access, licence, and Australian coverage
- Docling, OCR, paragraph-preserving legal parsers, LegalDocML/Akoma Ntoso, and citation resolvers
- terminal framework suitability for the TUI workbench model
- MCP patterns for scoped, provenance-bearing, capability-aware tools
- SourceSpan schema against nested provisions, overlapping spans, paragraph and page locators, scanned PDFs, external citations, and inferred multi-source relationships
- review state machine with legal research workflows and correction/dispute paths
- PDF parsing and OCR pipelines against representative Australian legal PDFs, including degraded fallback for unparseable documents
- terminal framework suitability before TUI scaffold implementation, including inline mode, alternate-screen mode, keyboard navigation, accessibility, and transcript export
- agent planner architecture, including model/provider boundary, command registry constraints, context assembly, failure handling, interruption, cost controls, and auditability

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
- DuckDB-backed graph-over-table or graph-extension approaches are primary spike candidates, subject to verification.
- Graphiti, FalkorDB, Kuzu, RDF/SPARQL backends, and other graph systems remain backend candidates behind `GraphProvider`, not the architecture itself.
- agentic TUI is command-governed and authority-aware.
- Evidence Packs prove process and sources, not legal correctness.
