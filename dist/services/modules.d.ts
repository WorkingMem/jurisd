/**
 * Data-module store + loader (Layer 1).
 *
 * Discovers parquet "data modules" under the modules root (default
 * `~/.jurisd/modules/`), validates each module's `manifest.json` against the
 * vendored schema, and exposes an in-memory registry of metadata only — no
 * parquet bytes, no embeddings are held in RSS. DuckDB is attached lazily
 * per-module on first query, mirroring the graceful-degrade lazy-import pattern
 * of `oalc.ts`.
 */
import { type Manifest } from "../data/manifest.js";
import { type DomainAdapter } from "./adapter.js";
/** Load status of a discovered module. */
export type ModuleStatus = "ready" | "invalid" | "yanked" | "unsupported_schema_version" | "capability_missing";
/** One discovered module: parsed manifest, absolute dir, load status. */
export interface ModuleEntry {
    name: string;
    manifest: Manifest | null;
    dir: string;
    status: ModuleStatus;
    /** Validation error / missing-capability detail for refused modules. */
    statusDetail?: string;
    /** Whether DuckDB views have been created for this module yet. */
    attached: boolean;
}
/** Override the modules root (and optionally the enabled flag). Test helper. */
export declare function setModulesRootForTest(dir: string | null, enabled?: boolean): void;
/** The four parquet files every schema_version-1 module carries. */
export declare const MODULE_PARQUET_FILES: {
    readonly documents: "documents.parquet";
    readonly chunks: "chunks.parquet";
    readonly edges: "edges.parquet";
    readonly unmatched: "unmatched_citations.parquet";
};
/**
 * Scan the modules root and (re)build the in-memory registry. Idempotent;
 * pass `force` to re-scan. Returns the registry's module map.
 *
 * Discovery runs once at startup and on an explicit `list_data_modules`
 * refresh. Holds metadata only.
 */
export declare function discoverModules(force?: boolean): Map<string, ModuleEntry>;
/** Return all discovered modules (scanning once if not yet scanned). */
export declare function listModules(force?: boolean): ModuleEntry[];
/** Return only `ready` modules. */
export declare function readyModules(force?: boolean): ModuleEntry[];
/** Look up a single module by manifest name. */
export declare function getModule(name: string): ModuleEntry | undefined;
/** Reset registry state (test helper). */
export declare function resetRegistry(): void;
/**
 * Lazily load @duckdb/node-api. Returns null when not installed, mirroring the
 * graceful-degrade pattern in oalc.ts. The whole local-module query layer is
 * unavailable without it; the registry/metadata view still works.
 */
export declare function tryLoadDuckDB(): Promise<typeof import("@duckdb/node-api") | null>;
/** Whether DuckDB is importable (used by the capability probe). */
export declare function isDuckDBAvailable(): Promise<boolean>;
/**
 * The four view names for a module, scoped by the validated manifest name so a
 * query never has to know file paths. The name is a guaranteed-safe SQL
 * identifier (MODULE_NAME_PATTERN, enforced at discovery + fetch).
 */
export declare function viewNames(name: string): {
    documents: string;
    chunks: string;
    edges: string;
    unmatched: string;
};
/**
 * Create the four lazy views for a module on first touch. The parquet path is
 * single-quote-escaped (a string literal inside `read_parquet(...)`), and the
 * view name comes only from the validated module name (never user input), so no
 * identifier injection is possible. Idempotent (`CREATE OR REPLACE VIEW`).
 */
export declare function attachModule(name: string): Promise<ModuleEntry | null>;
/**
 * Run a bound-parameter query against the shared DuckDB connection and return
 * rows as objects keyed by column name. All literal tool inputs MUST be passed
 * as `params` (bound `$1`, `$2`, …), never interpolated — tool inputs are
 * adversarial (design §1.3).
 */
export declare function runModuleQuery(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
/** The mandatory provenance metadata block on every local-module answer. */
export interface LocalModuleMetadata {
    source: "local_module";
    name: string;
    module_version: string;
    snapshot_date: string;
    /** Present only when the snapshot is older than config.modules.stalenessDays. */
    staleness_advisory?: string;
    /** Present only when a domain adapter refined the result (design §4.2). */
    enhancement?: string;
}
/**
 * Build the provenance metadata for an answer sourced from `entry`. Attaches a
 * staleness advisory when the snapshot is older than the configured threshold.
 */
export declare function buildMetadata(entry: ModuleEntry): LocalModuleMetadata;
/**
 * Normalise a citable provision reference to the canonical short form the
 * fixture/pipeline stores in `chunks.provision_ref`: collapse whitespace, lower
 * the leading kind word, and map long kind words to their abbreviations
 * (section→s, schedule→sch, regulation→reg, clause→cl).
 */
export declare function normaliseProvisionRef(raw: string): string;
/**
 * Choose the best `ready` module for a request. When `pin` names a ready module
 * it is used. Otherwise, among ready modules, prefer one whose
 * `coverage.jurisdictions` includes `jurisdiction` (when given); else the first
 * ready module. Returns null when no ready module qualifies.
 */
export declare function selectModules(opts?: {
    pin?: string;
    jurisdiction?: string;
    requireEmbedded?: boolean;
}): ModuleEntry[];
/** A single provision chunk + its owning document's provenance. */
export interface ProvisionResult {
    found: true;
    chunk_id: string;
    provision_ref: string;
    segment_type: string;
    text: string;
    char_start: number;
    char_end: number;
    citation: string;
    version_id: string;
    url: string;
    metadata: LocalModuleMetadata;
}
/** Typed not-found result so the router can descend to Layer 2. */
export interface NotFoundResult {
    found: false;
}
/**
 * Deterministic provision lookup. Resolves `act` (citation / work_id /
 * version_id) and a normalised `provision` ref against `chunks.provision_ref`,
 * over the best-covering ready module(s). Returns the first exact match or a
 * typed `{ found: false }`. No embedding, no ranking. Bound params only.
 */
export declare function getProvision(args: {
    act: string;
    provision: string;
    module?: string;
}): Promise<ProvisionResult | NotFoundResult>;
/** One node in the flat containment-tree result. */
export interface ActStructureNode {
    node_id: string;
    parent_id: string | null;
    label: string;
    depth: number;
    children: ActStructureNode[];
}
export interface ActStructureResult {
    found: boolean;
    root?: ActStructureNode;
    metadata?: LocalModuleMetadata;
}
/**
 * Walk an Act's containment tree over `act_provision` edges via a recursive CTE.
 * The depth guard doubles as a cycle backstop so a malformed module cannot hang
 * the runtime. Returns a nested tree, or `{ found: false }` when the Act is not
 * present in any ready module.
 */
export declare function getActStructure(args: {
    act: string;
    depth?: number;
    module?: string;
}): Promise<ActStructureResult>;
/** One row of the introspection view (metadata only, no attach). */
export interface ModuleSummary {
    name: string;
    module_version: string;
    jurisdictions: string[];
    types: string[];
    doc_count: number;
    chunk_count: number;
    embedding: {
        model_id: string;
        dim: number;
        normalised: boolean;
    } | null;
    status: ModuleStatus;
    statusDetail?: string;
    snapshot_date: string | null;
    stale: boolean;
}
/**
 * Introspection over the in-memory registry. No DuckDB attach: counts come from
 * the manifest `coverage`. Refused modules are included only when
 * `includeInvalid`, with their status reason, per the degrade-visibly tenet.
 */
export declare function listDataModules(opts?: {
    refresh?: boolean;
    includeInvalid?: boolean;
}): ModuleSummary[];
/** One citing-document hit with the provenance span of the citation. */
export interface CitingHit {
    version_id: string;
    citation: string;
    type: string;
    url: string;
    kind: "cites" | "considers";
    mention_text: string | null;
    pinpoint: string | null;
    char_start: number | null;
    char_end: number | null;
    metadata: LocalModuleMetadata;
}
export interface FindCitingResult {
    found: boolean;
    hits: CitingHit[];
}
/**
 * Local twin of `search_citing_cases`: documents in installed modules whose
 * text cites `target`, via edges of kind cites/considers whose dst resolves to
 * the target. Runs per ready module and unions the results — each hit carries
 * the metadata of the module it came from (each module is a closed world).
 */
export declare function findCiting(args: {
    target: string;
    kinds?: ("cites" | "considers")[];
    module?: string;
    limit?: number;
}): Promise<FindCitingResult>;
/** One semantically-ranked chunk hit. */
export interface SemanticHit {
    chunk_id: string;
    provision_ref: string;
    segment_type: string;
    text: string;
    char_start: number;
    char_end: number;
    citation: string;
    version_id: string;
    score: number;
    metadata: LocalModuleMetadata;
}
export interface SemanticSearchResult {
    found: boolean;
    hits: SemanticHit[];
    /** Per-module skip reasons (embedding-space mismatch, etc.) — degrade visibly. */
    notes: string[];
}
/**
 * Vector recall over a module's chunk embeddings. The query is embedded locally
 * (§3) into the module's space, then ranked by cosine similarity. Gated on the
 * local embedder being present AND the module being embedded with a matching
 * descriptor. Facet pre-filters are applied before ranking.
 *
 * Returns `found:false` with a note when the embedder is absent (degrade
 * visibly), never throwing into the result.
 */
export declare function semanticSearchLocal(args: {
    query: string;
    module?: string;
    k?: number;
    filter?: {
        jurisdiction?: string;
        type?: string;
        segment_type?: string;
    };
}, 
/**
 * The domain adapter that refines the LOCAL top-k (design §4.2). Defaults to
 * the baseline (pure cosine order). When it can rerank, the top-k LOCAL rows
 * are reordered and each hit's metadata carries `enhancement = adapter.label`.
 */
adapter?: DomainAdapter): Promise<SemanticSearchResult>;
//# sourceMappingURL=modules.d.ts.map