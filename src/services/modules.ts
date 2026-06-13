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

import * as fs from "node:fs";
import * as path from "node:path";
import { config } from "../config.js";
import {
  type Manifest,
  IMPLEMENTED_SCHEMA_VERSION,
  MODULE_NAME_PATTERN,
  validateManifest,
} from "../data/manifest.js";
import { getQueryEmbedder, activeEmbedderDescriptor, type EmbedderDescriptor } from "./embedder.js";
import { baselineAdapter, type DomainAdapter, type LocalChunk } from "./adapter.js";

/** Load status of a discovered module. */
export type ModuleStatus =
  | "ready"
  | "invalid"
  | "yanked"
  | "unsupported_schema_version"
  | "capability_missing";

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

/** Internal mutable registry shape. */
interface Registry {
  modules: Map<string, ModuleEntry>;
  scanned: boolean;
}

const registry: Registry = { modules: new Map(), scanned: false };

/**
 * Test/admin override for the modules root + enabled flag. When unset, the
 * loader reads the process `config` singleton. Tests set this so they can point
 * discovery at a scratch dir without re-importing the config singleton.
 */
let _override: { dir?: string; enabled?: boolean } | null = null;

/** Override the modules root (and optionally the enabled flag). Test helper. */
export function setModulesRootForTest(dir: string | null, enabled = true): void {
  _override = dir === null ? null : { dir, enabled };
  resetRegistry();
}

function modulesDirEffective(): string {
  return _override?.dir ?? config.modules.dir;
}

function modulesEnabledEffective(): boolean {
  return _override ? _override.enabled !== false : config.modules.enabled;
}

/** The four parquet files every schema_version-1 module carries. */
export const MODULE_PARQUET_FILES = {
  documents: "documents.parquet",
  chunks: "chunks.parquet",
  edges: "edges.parquet",
  unmatched: "unmatched_citations.parquet",
} as const;

/**
 * Read + parse a module's manifest.json. Returns null (never throws) when the
 * file is absent or unparseable, so a malformed module is skipped, not fatal.
 */
function readManifest(dir: string): { manifest?: unknown; error?: string } {
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return { error: "manifest.json not found" };
  }
  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    return { manifest: JSON.parse(raw) };
  } catch (err) {
    return { error: `manifest.json is not valid JSON: ${(err as Error).message}` };
  }
}

/**
 * Classify a parsed-and-validated manifest into a load status.
 *
 * Order mirrors design §1.2: schema_version → yanked → name pattern →
 * (capability checks happen later, in the probe-aware path). A manifest that
 * passes all gates is `ready`.
 */
function classifyManifest(
  manifest: Manifest,
  dirName: string,
): {
  status: ModuleStatus;
  detail?: string;
} {
  if (manifest.schema_version !== IMPLEMENTED_SCHEMA_VERSION) {
    return {
      status: "unsupported_schema_version",
      detail: `module declares schema_version ${manifest.schema_version}; loader implements ${IMPLEMENTED_SCHEMA_VERSION}`,
    };
  }
  if (manifest.yanked) {
    return { status: "yanked", detail: "module version has been yanked upstream" };
  }
  if (!MODULE_NAME_PATTERN.test(manifest.name)) {
    return {
      status: "invalid",
      detail: `manifest name '${manifest.name}' is not a safe identifier (${MODULE_NAME_PATTERN})`,
    };
  }
  // A renamed directory is a warning, not an error: identity is the manifest.
  if (manifest.name !== dirName) {
    console.warn(
      `[modules] directory '${dirName}' holds module '${manifest.name}'; manifest identity wins`,
    );
  }
  return { status: "ready" };
}

/**
 * Build a single ModuleEntry from a subdirectory. Never throws; refusal
 * reasons are recorded as a status + statusDetail per the degrade-visibly tenet.
 */
function buildEntry(modulesDir: string, dirName: string): ModuleEntry | null {
  const dir = path.join(modulesDir, dirName);
  if (!fs.statSync(dir).isDirectory()) return null;

  const { manifest: parsed, error: readError } = readManifest(dir);
  if (readError) {
    console.warn(`[modules] skipping '${dirName}': ${readError}`);
    return null;
  }

  const validation = validateManifest(parsed);
  if (!validation.valid) {
    return {
      name: dirName,
      manifest: null,
      dir,
      status: "invalid",
      statusDetail: validation.error,
      attached: false,
    };
  }

  const manifest = parsed as Manifest;
  const { status, detail } = classifyManifest(manifest, dirName);
  return {
    name: manifest.name,
    manifest,
    dir,
    status,
    statusDetail: detail,
    attached: false,
  };
}

/**
 * Scan the modules root and (re)build the in-memory registry. Idempotent;
 * pass `force` to re-scan. Returns the registry's module map.
 *
 * Discovery runs once at startup and on an explicit `list_data_modules`
 * refresh. Holds metadata only.
 */
export function discoverModules(force = false): Map<string, ModuleEntry> {
  if (registry.scanned && !force) return registry.modules;

  registry.modules.clear();
  registry.scanned = true;

  if (!modulesEnabledEffective()) return registry.modules;

  const modulesDir = modulesDirEffective();
  if (!fs.existsSync(modulesDir)) return registry.modules;

  let dirNames: string[];
  try {
    dirNames = fs.readdirSync(modulesDir);
  } catch (err) {
    console.warn(`[modules] cannot read modules dir ${modulesDir}: ${(err as Error).message}`);
    return registry.modules;
  }

  for (const dirName of dirNames) {
    if (dirName.startsWith(".")) continue;
    let entry: ModuleEntry | null;
    try {
      entry = buildEntry(modulesDir, dirName);
    } catch (err) {
      console.warn(`[modules] skipping '${dirName}': ${(err as Error).message}`);
      continue;
    }
    if (!entry) continue;
    // Identity is manifest name; last writer wins on a duplicate (warned).
    if (registry.modules.has(entry.name)) {
      console.warn(`[modules] duplicate module name '${entry.name}'; keeping first`);
      continue;
    }
    registry.modules.set(entry.name, entry);
  }

  return registry.modules;
}

/** Return all discovered modules (scanning once if not yet scanned). */
export function listModules(force = false): ModuleEntry[] {
  return Array.from(discoverModules(force).values());
}

/** Return only `ready` modules. */
export function readyModules(force = false): ModuleEntry[] {
  return listModules(force).filter((m) => m.status === "ready");
}

/** Look up a single module by manifest name. */
export function getModule(name: string): ModuleEntry | undefined {
  return discoverModules().get(name);
}

/** Reset registry state (test helper). */
export function resetRegistry(): void {
  registry.modules.clear();
  registry.scanned = false;
  _dbState = null;
  _duckdbUnavailable = false;
}

// ── Lazy DuckDB attach over parquet (design §1.3) ──────────────────────────

interface ModuleDbState {
  instance: import("@duckdb/node-api").DuckDBInstance;
  conn: import("@duckdb/node-api").DuckDBConnection;
}

let _dbState: ModuleDbState | null = null;
let _duckdbUnavailable = false;

/**
 * Lazily load @duckdb/node-api. Returns null when not installed, mirroring the
 * graceful-degrade pattern in oalc.ts. The whole local-module query layer is
 * unavailable without it; the registry/metadata view still works.
 */
export async function tryLoadDuckDB(): Promise<typeof import("@duckdb/node-api") | null> {
  if (_duckdbUnavailable) return null;
  try {
    return await import("@duckdb/node-api");
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND"
    ) {
      _duckdbUnavailable = true;
      console.warn(
        "[modules] @duckdb/node-api is not installed. Local-module query tools are disabled. " +
          "Run: npm install @duckdb/node-api",
      );
      return null;
    }
    throw err;
  }
}

/** Whether DuckDB is importable (used by the capability probe). */
export async function isDuckDBAvailable(): Promise<boolean> {
  return (await tryLoadDuckDB()) !== null;
}

/** Return (creating if necessary) the shared in-memory DuckDB connection. */
async function getDb(): Promise<ModuleDbState | null> {
  if (_dbState) return _dbState;
  const duckdb = await tryLoadDuckDB();
  if (!duckdb) return null;
  const instance = await duckdb.DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  _dbState = { instance, conn };
  return _dbState;
}

/**
 * The four view names for a module, scoped by the validated manifest name so a
 * query never has to know file paths. The name is a guaranteed-safe SQL
 * identifier (MODULE_NAME_PATTERN, enforced at discovery + fetch).
 */
export function viewNames(name: string): {
  documents: string;
  chunks: string;
  edges: string;
  unmatched: string;
} {
  return {
    documents: `${name}__documents`,
    chunks: `${name}__chunks`,
    edges: `${name}__edges`,
    unmatched: `${name}__unmatched`,
  };
}

/**
 * Create the four lazy views for a module on first touch. The parquet path is
 * single-quote-escaped (a string literal inside `read_parquet(...)`), and the
 * view name comes only from the validated module name (never user input), so no
 * identifier injection is possible. Idempotent (`CREATE OR REPLACE VIEW`).
 */
export async function attachModule(name: string): Promise<ModuleEntry | null> {
  const entry = getModule(name);
  if (!entry || entry.status !== "ready") return null;
  if (entry.attached) return entry;

  const db = await getDb();
  if (!db) return null;

  const v = viewNames(name);
  const file = (f: string): string => path.join(entry.dir, f).replace(/'/g, "''");
  const stmts = [
    `CREATE OR REPLACE VIEW "${v.documents}" AS SELECT * FROM read_parquet('${file(MODULE_PARQUET_FILES.documents)}')`,
    `CREATE OR REPLACE VIEW "${v.chunks}" AS SELECT * FROM read_parquet('${file(MODULE_PARQUET_FILES.chunks)}')`,
    `CREATE OR REPLACE VIEW "${v.edges}" AS SELECT * FROM read_parquet('${file(MODULE_PARQUET_FILES.edges)}')`,
    `CREATE OR REPLACE VIEW "${v.unmatched}" AS SELECT * FROM read_parquet('${file(MODULE_PARQUET_FILES.unmatched)}')`,
  ];
  for (const sql of stmts) {
    await db.conn.run(sql);
  }
  entry.attached = true;
  return entry;
}

/**
 * Run a bound-parameter query against the shared DuckDB connection and return
 * rows as objects keyed by column name. All literal tool inputs MUST be passed
 * as `params` (bound `$1`, `$2`, …), never interpolated — tool inputs are
 * adversarial (design §1.3).
 */
export async function runModuleQuery(
  sql: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  const db = await getDb();
  if (!db) return [];
  const prepared = await db.conn.prepare(sql);
  params.forEach((p, i) => bindParam(prepared, i + 1, p));
  const result = await prepared.run();
  return (await result.getRowObjectsJS()) as Record<string, unknown>[];
}

/** Bind one positional parameter, dispatching on JS runtime type. */
function bindParam(
  prepared: import("@duckdb/node-api").DuckDBPreparedStatement,
  index: number,
  value: unknown,
): void {
  if (value === null || value === undefined) {
    prepared.bindNull(index);
  } else if (typeof value === "number") {
    if (Number.isInteger(value)) prepared.bindInteger(index, value);
    else prepared.bindDouble(index, value);
  } else if (typeof value === "boolean") {
    prepared.bindBoolean(index, value);
  } else if (Array.isArray(value)) {
    // Used for list params (e.g. edge-kind filters, query vectors). DuckDB
    // infers the element type from the JS array.
    prepared.bindList(index, value as never);
  } else {
    prepared.bindVarchar(index, String(value));
  }
}

// ── Response metadata (design §2, ROUTING.md "Response metadata") ───────────

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

/** Days between an ISO date string and now (floored). */
function ageInDays(isoDate: string): number {
  const then = Date.parse(isoDate);
  if (Number.isNaN(then)) return 0;
  return Math.floor((Date.now() - then) / 86_400_000);
}

/**
 * Build the provenance metadata for an answer sourced from `entry`. Attaches a
 * staleness advisory when the snapshot is older than the configured threshold.
 */
export function buildMetadata(entry: ModuleEntry): LocalModuleMetadata {
  const m = entry.manifest!;
  const snapshotDate = m.snapshot.date;
  const meta: LocalModuleMetadata = {
    source: "local_module",
    name: m.name,
    module_version: m.module_version,
    snapshot_date: snapshotDate,
  };
  const age = ageInDays(snapshotDate);
  const threshold = config.modules.stalenessDays;
  if (age > threshold) {
    meta.staleness_advisory = `module snapshot is ${age} days old (>${threshold}); consider re-fetching`;
  }
  return meta;
}

// ── Provision-reference normalisation (design §2.1) ─────────────────────────

/**
 * Normalise a citable provision reference to the canonical short form the
 * fixture/pipeline stores in `chunks.provision_ref`: collapse whitespace, lower
 * the leading kind word, and map long kind words to their abbreviations
 * (section→s, schedule→sch, regulation→reg, clause→cl).
 */
export function normaliseProvisionRef(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  const kindMap: Record<string, string> = {
    section: "s",
    sect: "s",
    schedule: "sch",
    regulation: "reg",
    reg: "reg",
    clause: "cl",
    part: "pt",
    division: "div",
  };
  const m = collapsed.match(/^([A-Za-z]+)\s*(.*)$/);
  if (!m) return collapsed;
  const kindRaw = m[1]!.toLowerCase();
  const rest = m[2]!;
  const kind = kindMap[kindRaw] ?? kindRaw;
  return rest ? `${kind} ${rest}` : kind;
}

/**
 * Choose the best `ready` module for a request. When `pin` names a ready module
 * it is used. Otherwise, among ready modules, prefer one whose
 * `coverage.jurisdictions` includes `jurisdiction` (when given); else the first
 * ready module. Returns null when no ready module qualifies.
 */
export function selectModules(
  opts: {
    pin?: string;
    jurisdiction?: string;
    requireEmbedded?: boolean;
  } = {},
): ModuleEntry[] {
  let candidates = readyModules();
  if (opts.pin) {
    candidates = candidates.filter((m) => m.name === opts.pin);
  }
  if (opts.requireEmbedded) {
    candidates = candidates.filter((m) => m.manifest?.embedding != null);
  }
  if (opts.jurisdiction) {
    const matching = candidates.filter((m) =>
      m.manifest!.coverage.jurisdictions.includes(opts.jurisdiction!),
    );
    if (matching.length > 0) return matching;
  }
  return candidates;
}

// ── get_provision (design §2.1) ─────────────────────────────────────────────

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
export async function getProvision(args: {
  act: string;
  provision: string;
  module?: string;
}): Promise<ProvisionResult | NotFoundResult> {
  const provisionRef = normaliseProvisionRef(args.provision);
  const candidates = selectModules({ pin: args.module });
  for (const entry of candidates) {
    const attached = await attachModule(entry.name);
    if (!attached) continue;
    const v = viewNames(entry.name);
    const rows = await runModuleQuery(
      `SELECT c.chunk_id, c.provision_ref, c.segment_type, c.text,
              c.char_start, c.char_end, d.citation, d.version_id, d.url
         FROM "${v.chunks}" c
         JOIN "${v.documents}" d ON d.version_id = c.version_id
        WHERE (d.citation = $1 OR d.work_id = $1 OR d.version_id = $1)
          AND c.provision_ref = $2
        LIMIT 1`,
      [args.act, provisionRef],
    );
    const row = rows[0];
    if (row) {
      return {
        found: true,
        chunk_id: String(row.chunk_id ?? ""),
        provision_ref: String(row.provision_ref ?? ""),
        segment_type: String(row.segment_type ?? ""),
        text: String(row.text ?? ""),
        char_start: Number(row.char_start ?? 0),
        char_end: Number(row.char_end ?? 0),
        citation: String(row.citation ?? ""),
        version_id: String(row.version_id ?? ""),
        url: String(row.url ?? ""),
        metadata: buildMetadata(entry),
      };
    }
  }
  return { found: false };
}

// ── get_act_structure (design §2.2) ─────────────────────────────────────────

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
export async function getActStructure(args: {
  act: string;
  depth?: number;
  module?: string;
}): Promise<ActStructureResult> {
  const maxDepth = args.depth ?? 12;
  const candidates = selectModules({ pin: args.module });
  for (const entry of candidates) {
    const attached = await attachModule(entry.name);
    if (!attached) continue;
    const v = viewNames(entry.name);
    // Legislation provisions live inside the Act's own version, addressed by
    // pinpoint, so an act_provision edge's dst_version_id is typically the Act
    // version itself. The descended node is therefore identified by the edge
    // (edge_id) — not dst_version_id — so it never collides with the root. The
    // recursion chains on `e.src = t.match_id`, where the root's match_id is the
    // Act version and a descended node's match_id is its pinpoint; this walks
    // genuine sub-provision edges (src = a parent pinpoint) while a flat
    // Act->provision set terminates naturally after one level. The depth guard
    // is the cycle backstop for a malformed module.
    const rows = await runModuleQuery(
      `WITH RECURSIVE tree AS (
         SELECT d.version_id AS node_id, d.version_id AS match_id,
                CAST(NULL AS VARCHAR) AS parent_id, d.citation AS label, 0 AS depth
           FROM "${v.documents}" d
          WHERE (d.citation = $1 OR d.work_id = $1 OR d.version_id = $1)
         UNION ALL
         SELECT e.edge_id AS node_id, e.pinpoint AS match_id,
                t.node_id AS parent_id, e.pinpoint AS label, t.depth + 1 AS depth
           FROM "${v.edges}" e
           JOIN tree t ON e.src = t.match_id
          WHERE e.kind = 'act_provision'
            AND t.depth < $2
       )
       SELECT node_id, parent_id, label, depth FROM tree ORDER BY depth, label`,
      [args.act, maxDepth],
    );
    if (rows.length === 0) continue;
    const root = assembleTree(rows);
    if (root) {
      return { found: true, root, metadata: buildMetadata(entry) };
    }
  }
  return { found: false };
}

/** Assemble flat (node_id, parent_id, label, depth) rows into a nested tree. */
function assembleTree(rows: Record<string, unknown>[]): ActStructureNode | null {
  const byId = new Map<string, ActStructureNode>();
  let root: ActStructureNode | null = null;
  for (const r of rows) {
    const node: ActStructureNode = {
      node_id: String(r.node_id ?? ""),
      parent_id: r.parent_id == null ? null : String(r.parent_id),
      label: String(r.label ?? ""),
      depth: Number(r.depth ?? 0),
      children: [],
    };
    byId.set(node.node_id, node);
    if (node.parent_id === null) root = node;
  }
  for (const node of byId.values()) {
    if (node.parent_id !== null) {
      byId.get(node.parent_id)?.children.push(node);
    }
  }
  return root;
}

// ── list_data_modules (design §2.5) ─────────────────────────────────────────

/** One row of the introspection view (metadata only, no attach). */
export interface ModuleSummary {
  name: string;
  module_version: string;
  jurisdictions: string[];
  types: string[];
  doc_count: number;
  chunk_count: number;
  embedding: { model_id: string; dim: number; normalised: boolean } | null;
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
export function listDataModules(
  opts: {
    refresh?: boolean;
    includeInvalid?: boolean;
  } = {},
): ModuleSummary[] {
  const mods = listModules(opts.refresh ?? false);
  const threshold = config.modules.stalenessDays;
  return mods
    .filter((m) => opts.includeInvalid || m.status === "ready")
    .map((m): ModuleSummary => {
      const man = m.manifest;
      const snapshotDate = man?.snapshot.date ?? null;
      return {
        name: m.name,
        module_version: man?.module_version ?? "",
        jurisdictions: man?.coverage.jurisdictions ?? [],
        types: man?.coverage.types ?? [],
        doc_count: man?.coverage.doc_count ?? 0,
        chunk_count: man?.coverage.chunk_count ?? 0,
        embedding: man?.embedding ?? null,
        status: m.status,
        statusDetail: m.statusDetail,
        snapshot_date: snapshotDate,
        stale: snapshotDate ? ageInDays(snapshotDate) > threshold : false,
      };
    });
}

// ── find_citing (design §2.3) ───────────────────────────────────────────────

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
export async function findCiting(args: {
  target: string;
  kinds?: ("cites" | "considers")[];
  module?: string;
  limit?: number;
}): Promise<FindCitingResult> {
  const kinds = args.kinds && args.kinds.length > 0 ? args.kinds : ["cites", "considers"];
  const limit = args.limit ?? 50;
  const candidates = selectModules({ pin: args.module });
  const hits: CitingHit[] = [];

  for (const entry of candidates) {
    const attached = await attachModule(entry.name);
    if (!attached) continue;
    const v = viewNames(entry.name);
    const rows = await runModuleQuery(
      `SELECT DISTINCT src_d.version_id, src_d.citation, src_d.type, src_d.url,
              e.kind, e.mention_text, e.pinpoint, e.char_start, e.char_end
         FROM "${v.edges}" e
         JOIN "${v.documents}" src_d ON src_d.version_id = e.src
         JOIN "${v.documents}" tgt_d
              ON (tgt_d.work_id = e.dst_work_id OR tgt_d.version_id = e.dst_version_id)
        WHERE (tgt_d.citation = $1 OR tgt_d.work_id = $1 OR tgt_d.version_id = $1)
          AND list_contains($2, e.kind)
        ORDER BY e.kind DESC
        LIMIT $3`,
      [args.target, kinds, limit],
    );
    const meta = buildMetadata(entry);
    for (const row of rows) {
      hits.push({
        version_id: String(row.version_id ?? ""),
        citation: String(row.citation ?? ""),
        type: String(row.type ?? ""),
        url: String(row.url ?? ""),
        kind: row.kind === "considers" ? "considers" : "cites",
        mention_text: row.mention_text == null ? null : String(row.mention_text),
        pinpoint: row.pinpoint == null ? null : String(row.pinpoint),
        char_start: row.char_start == null ? null : Number(row.char_start),
        char_end: row.char_end == null ? null : Number(row.char_end),
        metadata: meta,
      });
    }
  }
  // 'considers' before 'cites' across the union.
  hits.sort((a, b) => b.kind.localeCompare(a.kind));
  return { found: hits.length > 0, hits: hits.slice(0, limit) };
}

// ── semantic_search_local (design §2.4) ─────────────────────────────────────

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
 * Whether a module's embedding descriptor is comparable to the embedder in use.
 * Embeddings from different models / dims are not comparable; a mismatch is a
 * hard gate (skipped with a typed note, never silently returned).
 */
function embeddingSpaceMatches(entry: ModuleEntry, embedder: EmbedderDescriptor): boolean {
  const e = entry.manifest?.embedding;
  if (!e) return false;
  return e.dim === embedder.dim && modelIdCompatible(e.model_id, embedder.model_id);
}

/** Loose model-id compatibility: bare model name matches across org-prefixed ids. */
function modelIdCompatible(manifestModelId: string, embedderModelId: string): boolean {
  const a = manifestModelId.toLowerCase();
  const b = embedderModelId.toLowerCase();
  const bareB = b.split("/").pop() ?? b;
  const bareA = a.split("/").pop() ?? a;
  return a === b || bareA === bareB || a.includes(bareB) || bareB.includes(a);
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
export async function semanticSearchLocal(
  args: {
    query: string;
    module?: string;
    k?: number;
    filter?: { jurisdiction?: string; type?: string; segment_type?: string };
  },
  /**
   * The domain adapter that refines the LOCAL top-k (design §4.2). Defaults to
   * the baseline (pure cosine order). When it can rerank, the top-k LOCAL rows
   * are reordered and each hit's metadata carries `enhancement = adapter.label`.
   */
  adapter: DomainAdapter = baselineAdapter,
): Promise<SemanticSearchResult> {
  const k = args.k ?? 10;
  const notes: string[] = [];

  const embed = await getQueryEmbedder();
  if (!embed) {
    notes.push(
      "local embedder unavailable (@huggingface/transformers not installed); semantic_search_local disabled",
    );
    return { found: false, hits: [], notes };
  }
  const embedderDesc = activeEmbedderDescriptor();

  const candidates = selectModules({
    pin: args.module,
    jurisdiction: args.filter?.jurisdiction,
    requireEmbedded: true,
  });
  if (candidates.length === 0) {
    notes.push("no embedded ready module available");
    return { found: false, hits: [], notes };
  }

  const queryVec = Array.from(await embed(args.query));
  const dim = queryVec.length;
  const hits: SemanticHit[] = [];

  for (const entry of candidates) {
    if (!embeddingSpaceMatches(entry, embedderDesc)) {
      notes.push(
        `module '${entry.name}' skipped: embedding descriptor ${JSON.stringify(
          entry.manifest?.embedding,
        )} does not match the active embedder (${embedderDesc.model_id}, dim ${embedderDesc.dim})`,
      );
      continue;
    }
    const attached = await attachModule(entry.name);
    if (!attached) continue;
    const v = viewNames(entry.name);
    // Fixed-size cast on both sides so array_cosine_similarity accepts the
    // vectors (parquet stores variable-length lists). The dim comes from the
    // embedder output length, not user input.
    const rows = await runModuleQuery(
      `SELECT c.chunk_id, c.provision_ref, c.segment_type, c.text,
              c.char_start, c.char_end, d.citation, d.version_id,
              array_cosine_similarity(c.embedding::FLOAT[${dim}], $1::FLOAT[${dim}]) AS score
         FROM "${v.chunks}" c
         JOIN "${v.documents}" d ON d.version_id = c.version_id
        WHERE ($2 IS NULL OR d.jurisdiction = $2)
          AND ($3 IS NULL OR d.type = $3)
          AND ($4 IS NULL OR c.segment_type = $4)
        ORDER BY score DESC
        LIMIT $5`,
      [
        queryVec,
        args.filter?.jurisdiction ?? null,
        args.filter?.type ?? null,
        args.filter?.segment_type ?? null,
        k,
      ],
    );
    const meta = buildMetadata(entry);
    for (const row of rows) {
      hits.push({
        chunk_id: String(row.chunk_id ?? ""),
        provision_ref: String(row.provision_ref ?? ""),
        segment_type: String(row.segment_type ?? ""),
        text: String(row.text ?? ""),
        char_start: Number(row.char_start ?? 0),
        char_end: Number(row.char_end ?? 0),
        citation: String(row.citation ?? ""),
        version_id: String(row.version_id ?? ""),
        score: Number(row.score ?? 0),
        metadata: meta,
      });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  let topK = hits.slice(0, k);

  // Optional domain-adapter refinement over the LOCAL top-k (never replaces
  // local recall). Absence (baseline) leaves cosine order untouched. A provider
  // failure inside rerank degrades to the input order (handled in the adapter).
  if (adapter.canRerank && adapter.rerank && topK.length > 0) {
    const localChunks: LocalChunk[] = topK.map((h) => ({
      chunk_id: h.chunk_id,
      text: h.text,
      score: h.score,
    }));
    const reordered = await adapter.rerank(args.query, localChunks);
    const byId = new Map(topK.map((h) => [h.chunk_id, h]));
    const refined: SemanticHit[] = [];
    for (const c of reordered) {
      const hit = byId.get(c.chunk_id);
      if (hit) refined.push({ ...hit, metadata: { ...hit.metadata, enhancement: adapter.label } });
    }
    if (refined.length > 0) topK = refined;
  }

  return { found: topK.length > 0, hits: topK, notes };
}
