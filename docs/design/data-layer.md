# WS-E: Server data layer design

**Status:** design (plan items E1–E7). **Audience:** the engineer implementing
the jurisd module store and the five data-layer recall tools.

This document specifies how the jurisd MCP server loads **data modules** (the
parquet bundles defined by [`MODULE_SPEC.md`][spec] in `jurisd-data`) and serves
them through five dedicated tools. It is the design that the E1–E7 implementation
builds against. It does not edit the routing-precedence contract
([`ROUTING.md`][routing]); it implements **Layer 1** of that contract — the
local-module layer that sits _above_ live AustLII and the OALC fallback.

[spec]: ../../../jurisd-data/MODULE_SPEC.md
[routing]: ../../../jurisd-data/ROUTING.md
[toolsurface]: ../decisions/tool-surface.md

## Scope and non-goals

In scope (this doc): the on-disk module store, discovery + manifest validation,
the lazy DuckDB attach, the five tools' schemas and queries, local query
embedding, the capability probe + provider-adapter interface, module fetching
with sha256 verification, and the test fixture strategy.

Out of scope: the precedence chain itself (locked in `ROUTING.md`), the pipeline
that _builds_ modules (`jurisd-data/pipeline`), and the live/OALC layers (WS-A,
WS-B, locked). Treatment derivation, FRBR `expression_date`, and amendment-history
edges are deferred per `MODULE_SPEC.md` and are not designed here.

## Design tenets (inherited)

- **Never load-all-into-memory.** Modules are parquet on disk; DuckDB scans them
  in place. A host may have many modules (legislation-cth + per-state
  legislation + decisions); the server must stay flat in RSS regardless of how
  many are installed.
- **Degrade visibly, never silently.** A missing optional dependency
  (`@duckdb/node-api`, the embedder) disables _only its feature_, reported by the
  capability probe — it never reorders routing and never throws into a tool
  result. This mirrors the existing `oalc.ts` graceful-degradation pattern.
- **Self-describing modules.** Everything needed to load and query a module is in
  its `manifest.json` + parquet. No out-of-band config keyed on module name.
- **Closed-world reads.** The graph tools (`get_act_structure`, `find_citing`)
  traverse only edges that exist in the `edges` table. They never infer.

---

## 1. The module store

### 1.1 On-disk layout

Modules live under a single root, default `~/.jurisd/modules/`, overridable with
`JURISD_MODULES_DIR`. One subdirectory per module, named by the manifest `name`:

```
~/.jurisd/modules/
  legislation-cth/
    manifest.json
    documents.parquet
    chunks.parquet
    edges.parquet
    unmatched_citations.parquet
  decisions-hca/
    manifest.json
    ...
```

The directory name is a convenience handle for humans and the `fetch-module`
flow; **identity is the manifest `name` + `module_version`**, never the
directory name. If they disagree, the manifest wins and the loader logs a warning
(a renamed directory is not an error).

A new config block mirrors the existing `oalc` block in `src/config.ts`:

```ts
modules: {
  /** Root dir for installed modules. Default ~/.jurisd/modules. */
  dir: string; // JURISD_MODULES_DIR
  /** When false, the whole local-module layer is disabled (Layer 1 skipped). */
  enabled: boolean; // JURISD_MODULES_ENABLED, default true
  /** Staleness threshold in days for the snapshot advisory. */
  stalenessDays: number; // JURISD_MODULE_STALENESS_DAYS, default 365
}
```

### 1.2 Discovery + manifest validation (on load)

Discovery runs **once at startup** (and on an explicit `list_data_modules`
refresh). For each subdirectory of the modules root:

1. Read `manifest.json`. Absent or unparseable → skip with a warning; never throw.
2. Validate against `manifest.schema.json` (vendored — see §1.4). A validation
   failure → the module is **refused** and recorded as `status: "invalid"` with
   the validation error, not loaded.
3. Check `schema_version`. The loader implements `{1}`. An unimplemented version
   → refused as `status: "unsupported_schema_version"`. (This is the
   `MODULE_SPEC` "loader refuses versions it does not implement" rule.)
4. Check `yanked`. A yanked module is refused as `status: "yanked"`.
5. Check the embedding descriptor against capability (§4): an
   `embedding == null` module is metadata/graph-only (no `semantic_search_local`).
   A **remote-embedder** module class (per `ROUTING.md`) is refused unless the
   matching online capability is present.
6. **Integrity is lazy, not eager.** sha256 verification of each parquet against
   `files[].sha256` is **expensive** (hashing 100s of MB × N modules at every
   startup would blow the 3-minute kill budget). The default is to verify hashes
   **at fetch/install time** (§5) and trust thereafter; a `--verify` admin path
   and `JURISD_MODULE_VERIFY_ON_LOAD=true` force per-load verification for the
   paranoid. Row-count cross-checks (`files[].rows`) are cheap (`SELECT count(*)`)
   and run lazily on first attach.

The result of discovery is an **in-memory registry**: a `Map<name, ModuleEntry>`
holding the parsed manifest, the absolute directory path, the load `status`, and
a _lazy_ DuckDB handle (null until first query). The registry holds **metadata
only** — no parquet data, no embeddings. This is what `list_data_modules` reads.

```ts
interface ModuleEntry {
  name: string;
  manifest: Manifest; // parsed + validated
  dir: string; // absolute path
  status: "ready" | "invalid" | "yanked" | "unsupported_schema_version" | "capability_missing";
  statusDetail?: string; // validation error / missing capability
  attached: boolean; // DuckDB views created yet?
}
```

### 1.3 Lazy DuckDB attach over parquet

DuckDB is loaded with the **same lazy-import + graceful-degrade pattern** as
`oalc.ts` (`tryLoadDuckDB()` catching `ERR_MODULE_NOT_FOUND`). One shared
in-memory DuckDB instance (`:memory:`) serves all modules — we do **not** open a
file-backed database. Parquet is queried in place via `read_parquet()`; DuckDB
streams from disk and never materialises a whole table into RSS.

Attach is **per-module, on first query**, not at discovery. On first touch of
module `M`, the loader creates lightweight views scoped by name so a query never
has to know file paths:

```sql
CREATE OR REPLACE VIEW "M__documents" AS
  SELECT * FROM read_parquet('<dir>/documents.parquet');
CREATE OR REPLACE VIEW "M__chunks"    AS
  SELECT * FROM read_parquet('<dir>/chunks.parquet');
CREATE OR REPLACE VIEW "M__edges"     AS
  SELECT * FROM read_parquet('<dir>/edges.parquet');
CREATE OR REPLACE VIEW "M__unmatched" AS
  SELECT * FROM read_parquet('<dir>/unmatched_citations.parquet');
```

View names are derived from the validated manifest `name`. The `name` is
constrained to `^[a-z0-9][a-z0-9-]*$` at fetch time (§5) so it is always a safe
SQL identifier; the loader additionally rejects any name failing that pattern at
discovery, closing SQL-identifier injection. **All literal values** in queries
(provision ids, act ids, citations) are passed as DuckDB **bound parameters**
(`$1`, `$2`), never string-interpolated — a stricter stance than the existing
`oalc.ts` escaper, justified because tool inputs are adversarial.

Many modules: each module's four views cost ~nothing until queried (a view is a
stored SELECT). A 30-module host has 120 views and still zero parquet bytes in
RSS until a tool actually runs a query that touches one.

### 1.4 Vendored manifest schema

`manifest.schema.json` lives in `jurisd-data`, but the server **must not depend
on the sibling repo at runtime or test time**. The schema is vendored into
`src/data/manifest.schema.json` (copied, with a provenance line in the commit, not
in the file body). A small CI check (or a unit test) compares the vendored copy
against the upstream when both repos are checked out, so drift is caught in
development without a runtime dependency. Validation uses a tiny dependency-light
JSON-schema validator (`ajv`, already transitively common) or a hand-rolled
check; the choice is an implementation detail, but it must run with **no network
and no sibling repo**.

---

## 2. The five tools

All five are **dedicated** (not mode-merged), per [`tool-surface.md`][toolsurface]
R5: they map to crisp, frequent, distinct intents. Final surface is 10 base + 5
WS-E = 15, under the 18 ceiling. They live in a new `src/services/modules.ts`
(loader + query helpers) and are registered in `src/server.ts` alongside the
existing 10.

Common response shape: every tool returns the standard MCP `content` text block,
and — per `ROUTING.md` "Response metadata (mandatory)" — local-module answers
carry `metadata.source = "local_module"` with `name` + `module_version`, and
`metadata.snapshot_date` from the manifest `snapshot.date`. When that snapshot is
older than `stalenessDays`, a `metadata.staleness_advisory` string is attached.
The tools accept an optional `module` argument to pin a specific module; when
omitted, the loader searches **ready** modules and (where a tie is possible)
prefers the module whose `coverage.jurisdictions` matches the request.

### 2.1 `get_provision` — deterministic provision lookup

Highest-traffic deterministic lookup; a dedicated name aids agent selection.
Resolves a single provision of an Act (or instrument) by its citable handle.

**Input schema:**

```ts
{
  act: z.string().min(1)
    .describe("Act work identity or citation, e.g. 'Competition and Consumer Act 2010 (Cth)' or a work_id"),
  provision: z.string().min(1)
    .describe("Citable provision reference, e.g. 's 18', 'sch 2', 'reg 12', 'cl 4(1)'"),
  module: z.string().optional()
    .describe("Pin a specific module by name; otherwise the best-covering ready module is used"),
  format: formatEnum.optional(),
}
```

**Resolution:** `act` resolves to a `documents.version_id` (or `work_id`) by
exact citation match first, then `work_id` equality. `provision` is normalised
(whitespace, `s`/`section`, `sch`/`schedule`) and matched against
`chunks.provision_ref`. Deterministic = exact reference match, no embedding, no
ranking. Returns the chunk text + provenance (`char_start`/`char_end`) + the
owning document's citation.

**Query (bound params):**

```sql
SELECT c.chunk_id, c.provision_ref, c.segment_type, c.text,
       c.char_start, c.char_end, d.citation, d.version_id, d.url
FROM   "M__chunks"    c
JOIN   "M__documents" d ON d.version_id = c.version_id
WHERE  (d.citation = $1 OR d.work_id = $1 OR d.version_id = $1)
  AND  c.provision_ref = $2
LIMIT 1;
```

Miss → the tool returns a typed not-found result (not an error) so the
`ROUTING.md` precedence chain can descend to Layer 2. The handler surfaces
`{ found: false }`; the _router_ (E3, post-B2) decides to fall through.

### 2.2 `get_act_structure` — recursive CTE over edges

Returns the containment tree of an Act: Act → Part → Division → section/schedule
/clause, walked over the `act_provision` edges (`edges.kind = 'act_provision'`,
the act→own-provision containment relationship).

**Input schema:**

```ts
{
  act: z.string().min(1).describe("Act work identity or citation"),
  depth: z.number().int().min(1).max(12).optional().describe("Max tree depth; default unbounded within the Act"),
  module: z.string().optional(),
  format: formatEnum.optional(),
}
```

**Query — recursive CTE** over the edge graph, rooted at the Act's
`version_id`, descending `act_provision` edges. The edge `src` is the container,
the resolved `dst_version_id` (or the chunk addressed by `pinpoint`) is the
child; `provision_ref` + `segment_type` from `chunks` label each node:

```sql
WITH RECURSIVE tree AS (
  -- root: the Act document itself
  SELECT d.version_id AS node_id, CAST(NULL AS VARCHAR) AS parent_id,
         d.citation AS label, 0 AS depth
  FROM   "M__documents" d
  WHERE  (d.citation = $1 OR d.work_id = $1 OR d.version_id = $1)
  UNION ALL
  -- descend act_provision edges
  SELECT e.dst_version_id AS node_id, e.src AS parent_id,
         e.pinpoint AS label, t.depth + 1 AS depth
  FROM   "M__edges" e
  JOIN   tree t ON e.src = t.node_id
  WHERE  e.kind = 'act_provision'
    AND  t.depth < $2            -- depth guard (also a cycle backstop)
)
SELECT node_id, parent_id, label, depth FROM tree ORDER BY depth, label;
```

The `depth` guard doubles as a **cycle backstop** (closed-world edges should be
acyclic, but a malformed module must not hang the 3-minute-kill runtime). The
handler assembles the flat rows into a nested tree for the response.

### 2.3 `find_citing` — local twin of `search_citing_cases`

The offline twin of the live removed.invalid `search_citing_cases`. Given a target
document, returns documents in **local modules** whose text cites it — an edge
traversal over `edges.kind IN ('cites','considers')` where the `dst` resolves to
the target.

**Input schema:**

```ts
{
  target: z.string().min(1)
    .describe("Citation or work/version identity of the cited document, e.g. 'Mabo v Queensland (No 2) [1992] HCA 23'"),
  kinds: z.array(z.enum(["cites","considers"])).optional()
    .describe("Edge kinds to include; default both. 'considers' is the stronger substantive-engagement signal"),
  module: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  format: formatEnum.optional(),
}
```

**Query:** resolve `target` to a `work_id`/`version_id`, then find edges whose
`dst_work_id` or `dst_version_id` equals it; join back to `documents` for the
**source** (citing) document metadata:

```sql
SELECT DISTINCT src_d.version_id, src_d.citation, src_d.type, src_d.url,
       e.kind, e.mention_text, e.pinpoint, e.char_start, e.char_end
FROM   "M__edges"     e
JOIN   "M__documents" src_d ON src_d.version_id = e.src
JOIN   "M__documents" tgt_d ON (tgt_d.work_id = e.dst_work_id
                            OR  tgt_d.version_id = e.dst_version_id)
WHERE  (tgt_d.citation = $1 OR tgt_d.work_id = $1 OR tgt_d.version_id = $1)
  AND  e.kind = ANY($2)
ORDER BY e.kind DESC          -- 'considers' before 'cites'
LIMIT  $3;
```

This is the local twin: `search_citing_cases` hits removed.invalid's citator (live,
sampled); `find_citing` is deterministic over installed modules and returns the
provenance span of each citation. The two are explicit, separate tools precisely
so the caller chooses source (R5 rationale). Across multiple ready modules the
loader runs the query per module and unions the results (each module is a closed
world; the union is honest about which module each hit came from via
`metadata`).

### 2.4 `semantic_search_local` — local query embedding + cosine over chunks

Vector recall over a module's chunk embeddings. The query string is embedded
**locally** (§3) into the module's embedding space, then ranked by cosine
similarity against `chunks.embedding`. Gated on two capabilities: the local
embedder must be present (§3) **and** the target module must be embedded
(`manifest.embedding != null`).

**Input schema:**

```ts
{
  query: z.string().min(1).describe("Natural-language query, embedded locally"),
  module: z.string().optional().describe("Pin a module; otherwise all embedded ready modules whose embedding model_id+dim match the local embedder"),
  k: z.number().int().min(1).max(50).default(10),
  filter: z.object({
    jurisdiction: z.string().optional(),
    type: z.enum(["decision","primary_legislation","secondary_legislation","bill"]).optional(),
    segment_type: z.string().optional(),
  }).optional().describe("Facet pre-filters applied before ranking"),
  format: formatEnum.optional(),
}
```

**Embedding-space match (hard gate).** A module's chunks were embedded with a
specific `model_id` + `dim` + `normalised` (manifest `embedding`). The server may
only search a module whose descriptor **matches the local embedder** it will use
to embed the query — embeddings from different models are not comparable. A
mismatched module is skipped with a typed `metadata` note, never silently
returned.

**Facet pre-filter then rank.** The facet columns (`d.jurisdiction`, `d.type`,
`c.segment_type`) are applied as a WHERE clause _before_ the cosine ranking, so
the vector math runs over the smallest candidate set. Cosine over normalised
vectors is a dot product; DuckDB exposes `array_cosine_similarity` / `list_dot_product`.

```sql
SELECT c.chunk_id, c.provision_ref, c.segment_type, c.text,
       c.char_start, c.char_end, d.citation, d.version_id,
       array_cosine_similarity(c.embedding, $1::FLOAT[384]) AS score
FROM   "M__chunks"    c
JOIN   "M__documents" d ON d.version_id = c.version_id
WHERE  ($2 IS NULL OR d.jurisdiction = $2)
  AND  ($3 IS NULL OR d.type = $3)
  AND  ($4 IS NULL OR c.segment_type = $4)
ORDER BY score DESC
LIMIT  $5;
```

(`$1` = the locally-embedded query vector; `384` = bge-small dim from the
manifest.) Where the optional capability adapter supplies a reranker (§4), the
top-k LOCAL rows are reordered by the adapter; absence leaves cosine order.

#### VSS index vs brute force — the decision, with a benchmark plan

At the baseline corpus size (**~857k chunks**, the legislation-cth + decisions
target), the question is whether to build a DuckDB **VSS** HNSW index or to brute-
force the cosine scan.

**Decision: brute force first, VSS behind a feature flag and a benchmark gate.**
Rationale:

- **Brute force is exact and zero-build.** 857k × 384 float32 ≈ **1.3 GB** of
  vectors. A full scan is a streamed dot-product DuckDB executes in parallel over
  parquet row-groups; on a laptop this is expected in the low hundreds of ms —
  _under_ the interactive budget and far under the 3-minute kill. No index to
  build, no index to keep in sync with the parquet, no extra RSS held between
  queries (DuckDB streams from disk).
- **VSS (HNSW) trades exactness + build cost for latency.** DuckDB's `vss`
  extension builds an in-memory HNSW index that must be **rebuilt on load** (it is
  not persisted across the parquet → it persists only into a DuckDB file, which we
  deliberately avoid in §1.3). Rebuilding an HNSW over 857k×384 at every startup
  reintroduces exactly the cold-start cost the lazy-attach design avoids, and HNSW
  is **approximate** (recall < 100%), which is a poor trade for a legal-recall tool
  where a missed provision is a real harm.
- **The facet pre-filter shrinks the brute-force set.** Most real queries carry a
  jurisdiction/type/segment filter; the scan rarely touches all 857k.

**Benchmark plan (the gate that can flip the decision):**

1. Build a fixture at the real scale: 857k synthetic chunks × 384 dims (random
   unit vectors), one parquet, matching the real schema.
2. Measure **brute-force cosine** p50/p95/p99 latency for: (a) no filter,
   (b) a jurisdiction filter (~1/8 of rows), (c) a tight `segment_type` filter.
   Run under `nohup` + `sleep`/`tail` polling (a 857k build can exceed 2 min).
3. Build the **VSS HNSW** index; measure index build time (cold start cost) and
   query p50/p95 + **recall@10** vs the brute-force ground truth.
4. **Gate:** keep brute force as default if its p95 (filtered) is within the
   interactive budget (target ≤ 750 ms warm). Flip to VSS _only_ if brute force
   misses the budget at 857k AND VSS recall@10 ≥ 0.98. The flag is
   `JURISD_VSS=true`; the default ships brute force.
5. Re-run the gate when a module materially exceeds 857k (e.g. a multi-state
   decisions module). The benchmark fixture and harness are vendored under
   `src/test/performance/` so the gate is reproducible.

This keeps the baseline **exact, offline, zero-build**, and makes the VSS switch
an evidence-gated optimisation rather than a default complexity.

### 2.5 `list_data_modules` — introspection

Admin/introspection over the in-memory registry (§1.2) — **no DuckDB attach
needed for the metadata view**; counts come from the manifest `coverage`.

**Input schema:**

```ts
{
  refresh: z.boolean().optional().describe("Re-scan the modules dir before listing"),
  includeInvalid: z.boolean().optional().describe("Include refused modules with their status reason"),
  format: formatEnum.optional(),
}
```

**Output:** per module — `name`, `module_version` (the `variant`/version handle),
`jurisdiction` (from `coverage.jurisdictions`), `type` (from `coverage.types`),
`doc_count` + `chunk_count` (from `coverage`), `embedding` descriptor (or
`null`/unembedded), `status` (`ready` / refused-with-reason), `snapshot.date`,
and whether it is stale. Refused modules are listed (when `includeInvalid`) with
their `statusDetail` so a missing capability or schema mismatch is _visible_, per
the degrade-visibly tenet. This is the tool an operator runs to answer "what can
this server answer offline, and why is module X not loading".

---

## 3. Local query embedding

`semantic_search_local` must embed the query into the **same space** the module's
chunks were embedded in: **bge-small-en-v1.5**, 384-dim, L2-normalised (the
manifest `embedding` descriptor). This must be a **pure-local, offline, no-key**
baseline — the whole point of Layer 1 is the zero-network path.

### 3.1 The choice: `@huggingface/transformers` (transformers.js)

**Decision: `@huggingface/transformers` (transformers.js v3) as the
optionalDependency, running the ONNX `bge-small-en-v1.5` with the
`onnxruntime-node` backend it bundles.** Candidates compared:

| Concern             | transformers.js (v3)                                                           | bare onnxruntime-node                                                       |
| ------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Tokeniser           | **bundled** (WordPiece for BGE, matches training)                              | must hand-port the HF tokeniser (error-prone, the silent-wrong-vector trap) |
| Pooling / normalise | `pipeline('feature-extraction', { pooling:'mean', normalize:true })` one-liner | hand-roll mean-pooling + L2 norm                                            |
| Model fetch         | HF hub cache, pinnable + offline (`env.allowRemoteModels=false`)               | manual download + path wiring                                               |
| Native backend      | uses `onnxruntime-node` under the hood on Node                                 | the same runtime, lower-level                                               |
| Offline/no-key      | yes (cache the model once, then `localModelPath`)                              | yes                                                                         |
| Failure surface     | one import gate (matches `oalc.ts` pattern)                                    | two (runtime + tokeniser)                                                   |

The deciding factor is the **tokeniser**: BGE's retrieval quality depends on
matching the exact tokenisation + mean-pooling + normalisation used at module
build time. transformers.js ships that pipeline verified against the HF model;
bare onnxruntime-node makes the caller reconstruct it, and a subtly-wrong
tokeniser produces _plausible but wrong_ vectors — the worst failure mode for a
recall tool, because it fails silently. transformers.js uses `onnxruntime-node`
as its Node backend anyway, so we get the native runtime's speed without owning
the pre/post-processing.

### 3.2 Wiring

- New optionalDependency `@huggingface/transformers`, lazy-imported with the same
  `tryLoad…()` / `ERR_MODULE_NOT_FOUND` graceful-degrade pattern as `oalc.ts` and
  the module loader. Absent → `semantic_search_local` is unavailable (reported by
  the capability probe), every other tool unaffected.
- The model is **pinned by id + revision** and cached under
  `~/.jurisd/models/`. First run may download (~130 MB); thereafter
  `env.allowRemoteModels=false` + `env.localModelPath` forces fully-offline. A
  `JURISD_EMBED_OFFLINE=true` hard-fails rather than reaching the network, for
  air-gapped installs (with a clear typed error telling the operator to
  pre-seed the model dir).
- The embedder is a singleton `getQueryEmbedder()` created on first
  `semantic_search_local`, not at startup — startup stays fast; embedding cost is
  paid only when the feature is used.
- It emits a `Float32Array(384)`, L2-normalised, matching the manifest
  descriptor. The loader asserts `dim === manifest.embedding.dim` and
  `model_id` compatibility before running the cosine query (§2.4 hard gate).

### 3.3 Baseline guarantee

With `@huggingface/transformers` installed and the model cached, the entire
semantic path is **local, offline, key-free**. No vendor, no account, no network.
This is the floor every install gets. Everything in §4 is _additive_ on top of
this floor and its absence never drops below it.

---

## 4. Capability probe + provider-adapter

### 4.1 The probe (startup)

`ROUTING.md` mandates a startup capability probe. WS-E extends it with the
data-layer capabilities. The probe reports, without changing routing precedence:

- `duckdb` — is `@duckdb/node-api` importable? (gates all five tools' queries)
- `local_embeddings` — is `@huggingface/transformers` importable + the model
  available? (gates `semantic_search_local`)
- `modules` — count of `ready` modules and of refused ones
- `domain_adapter` — is a domain-specialised provider configured **and
  reachable**? (below)

A missing capability disables only its feature, visibly. The probe result is what
`list_data_modules` and a future `health`/`capabilities` introspection surface
reads.

### 4.2 Vendor-neutral provider-adapter interface

The semantic path has two **optional** enhancement slots that operate **over the
top-k LOCAL results** — they never replace local recall, they refine it:

- **rerank** — reorder the locally-retrieved top-k by a stronger relevance model.
- **extractive-QA** — given the query + a locally-retrieved chunk, return the
  best answer span _within that chunk_.

Both are expressed through one vendor-neutral interface so no vendor name leaks
into the core:

```ts
interface DomainAdapter {
  /** Vendor-neutral capability flags. */
  canRerank: boolean;
  canExtractiveQA: boolean;
  /** Provider-interpolated display label, e.g. "Isaacus-enhanced". */
  label: string;
  /** Reorder local top-k. Input + output are LOCAL chunks; never fetches new docs. */
  rerank?(query: string, chunks: LocalChunk[]): Promise<LocalChunk[]>;
  /** Extract an answer span from a LOCAL chunk. */
  extractiveQA?(
    query: string,
    chunk: LocalChunk,
  ): Promise<{ span: string; start: number; end: number } | null>;
}
```

- **Baseline adapter** (always present): `canRerank=false`, `canExtractiveQA=false`,
  `label="baseline"`. `semantic_search_local` returns pure local cosine order. No
  network, no key.
- **Domain-specialised adapter** (slot): selected **iff** a provider is configured
  _and reachable_. The display label is **provider-interpolated** — e.g. with
  `ISAACUS_API_KEY` present and the endpoint reachable, the probe reports
  `domain_adapter: { label: "Isaacus-enhanced", canRerank: true, canExtractiveQA: true }`,
  and `semantic_search_local` responses carry `metadata.enhancement = "Isaacus-enhanced"`.

**Absence degrades silently to baseline, never errors.** If the key is unset, or
set-but-unreachable (probe failed), the adapter is the baseline one; the tool
still returns local cosine results. A reachability failure is logged once and
reported by the probe, never thrown into a tool result.

**Framing rule (binding):** the adapter is described only as **baseline vs
domain-specialised**, with a **provider-interpolated label**. Never "free vs
premium", never "basic vs pro", anywhere — not in tool descriptions, response
metadata, docs, or logs. The distinction is _capability presence_, full stop.

---

## 5. fetch-module — obtaining modules

Modules are published as **GitHub release assets** on the `jurisd-data` repo
(per the C6 publish flow): each module version is a release whose assets are the
four parquet files + `manifest.json`. The manifest's `base_uri` already points at
the canonical asset location, and `files[].sha256` is the integrity contract.

### 5.1 The decision: a CLI subcommand, not a tool

**Decision: `fetch-module` is a CLI subcommand (`jurisd fetch-module <name>`),
not an MCP tool.** Rationale:

- It is an **install-time / operator** action, not a query an LLM should run
  mid-conversation. Keeping it off the tool surface protects the 18-tool ceiling
  (R5) and avoids an LLM triggering a multi-hundred-MB download as a side effect.
- It writes to the filesystem and the network in a way that wants a human in the
  loop (disk space, network egress, licence acknowledgement) — a CLI prompt fits;
  a silent tool call does not.
- `list_data_modules` remains the in-conversation way to _see_ what is installed;
  fetching is deliberately a separate, operator-driven step.

The entry point gains subcommand dispatch in `src/index.ts` (the existing `main()`
branches on transport; it gains a `fetch-module` / `list-modules` / `verify-module`
branch before the server starts). No new heavyweight CLI framework — a thin
`process.argv` switch.

### 5.2 The fetch flow

```
jurisd fetch-module legislation-cth [--version X.Y.Z] [--modules-dir DIR]
```

1. Resolve the release: GitHub releases API on `jurisd-data`, pick the named
   module's latest (or pinned) release.
2. Download `manifest.json` first. Validate it against the **vendored** schema
   (§1.4) and check `schema_version` is implemented and `yanked === false`
   **before** downloading any parquet (fail fast, save bandwidth).
3. Download each `files[].path` from `base_uri` to a temp dir.
4. **sha256-verify each file against `files[].sha256`** (lowercase hex, the
   schema pattern `^[a-f0-9]{64}$`). Also cross-check `files[].rows` via a cheap
   DuckDB `count(*)` if DuckDB is present. Any mismatch → abort, delete the temp
   dir, exit non-zero with a typed message naming the file and the expected vs
   actual hash. **Never** install a partially-verified module.
5. Atomic install: move the verified temp dir to
   `~/.jurisd/modules/<name>/` (replacing any prior version atomically via a
   temp-then-rename, so a half-written module never appears to the loader).
6. Print the licence attribution lines from `manifest.licence.attribution` (the
   CC-BY obligation) so the operator sees the redistribution terms at install.

Because verification happens here, the **load path can trust** the hashes by
default (§1.2 step 6), keeping startup fast.

### 5.3 Lifecycle

`verify-module <name>` re-runs step 4 against installed files on demand (the
paranoid / CI path). The staleness advisory (§2 metadata) tells a consumer at
query time when an installed snapshot is older than `stalenessDays`; refreshing
is a re-`fetch-module`. A `yanked` upstream release is refused at load (§1.2);
`list_data_modules --refresh` surfaces it.

---

## 6. Test strategy

### 6.1 A vendored, self-contained fixture module

**Binding constraint: the jurisd test suite must not depend on the `jurisd-data`
sibling repo at test time.** The existing `jurisd-data/fixture-module/` (2 docs,
3 chunks, 2 edges, 1 unmatched, `embedding: null`) is the reference, but the
server's tests get their **own copy**, vendored under
`src/test/fixtures/modules/fixture/`. It is copied/adapted from the sibling
fixture, committed into this repo, and never read from `../jurisd-data` at
runtime or test time.

Two fixture variants are needed because the reference fixture is **unembedded**
(`embedding: null`), and `semantic_search_local` needs vectors:

- `src/test/fixtures/modules/fixture/` — the graph/deterministic fixture (mirrors
  the reference: documents/chunks/edges/unmatched, `embedding: null`). Exercises
  `get_provision`, `get_act_structure`, `find_citing`, `list_data_modules`, and
  the load/validate/refuse paths.
- `src/test/fixtures/modules/fixture-embedded/` — a tiny embedded fixture: a
  handful of chunks with **real bge-small 384-dim vectors** (or, to keep the
  fixture key-free and deterministic, fixed pre-computed 384-dim vectors stored in
  the parquet, with a known query vector and known expected ranking). Exercises
  `semantic_search_local`'s cosine path + the embedding-space gate, without
  requiring the embedder dependency to be installed in CI.

A tiny build script (`src/test/fixtures/modules/build.ts`, adapted from
`jurisd-data/fixture-module/build_fixture.py` but in TS so the repo is
self-contained) regenerates both, and a checked-in `manifest.json` per fixture
carries correct sha256 + row counts so the validation/verify tests run against
real hashes.

### 6.2 What the tests cover

- **Loader/registry:** discovery of a multi-module dir; refusal of an
  unimplemented `schema_version`, a `yanked` module, an invalid manifest, a
  bad-name (SQL-identifier) module; the in-memory registry holds metadata only.
- **DuckDB queries (skipped when DuckDB absent):** each of the five tools against
  the fixture, asserting exact rows for the deterministic ones, tree shape for
  `get_act_structure`, edge hits for `find_citing`, and cosine ranking for
  `semantic_search_local` against the embedded fixture with a known query vector.
  These follow the existing pattern of `it.skipIf(!duckdbAvailable)` so the
  optional dependency does not make CI red.
- **Capability probe + adapter:** probe reports correct flags with/without
  DuckDB + embedder; the adapter degrades to `label:"baseline"` when no provider
  key is set; the provider-interpolated label appears only when a (mocked)
  reachable provider is present; **no "free/premium" string** appears anywhere
  (a grep assertion in the test).
- **fetch-module:** sha256 verification rejects a tampered file; a `schema_version`
  the loader does not implement is refused before parquet download; atomic
  install leaves no half-written module on failure. Network is mocked; no live
  GitHub call in unit tests.
- **Routing metadata:** every fixture answer carries `metadata.source =
"local_module"` + `name`/`module_version` + `snapshot_date`, and a deliberately
  old fixture snapshot triggers the staleness advisory.

### 6.3 Guardrails (anti-stall / anti-death)

- Unit tests run with no network and no sibling repo; the 857k benchmark
  (§2.4) lives under `src/test/performance/` and is **not** in the default unit
  run (it is run under `nohup` + `sleep`/`tail` polling, never inline).
- DuckDB-dependent and embedder-dependent tests are `skipIf`-gated so a machine
  without the optional deps still gets a green unit run, matching the project's
  rule that optional-dependency absence never makes CI red.

---

## Implementation order (E1–E7 mapping)

1. **E1** — config block + module store layout + vendored schema (§1.1, §1.4).
2. **E2** — discovery + validation + capability probe (§1.2, §4.1).
3. **E3** — lazy DuckDB attach + the three deterministic/graph tools
   (`get_provision`, `get_act_structure`, `find_citing`) + Layer-1 routing wire
   (only after WS-B's B2 merges, per `ROUTING.md`) (§1.3, §2.1–2.3).
4. **E4** — local query embedding + `semantic_search_local` (brute force) (§3, §2.4).
5. **E5** — provider-adapter interface + baseline adapter + `list_data_modules`
   (§4.2, §2.5).
6. **E6** — `fetch-module` CLI + sha256 verification (§5).
7. **E7** — VSS benchmark + gate decision; vendored performance fixture (§2.4).
