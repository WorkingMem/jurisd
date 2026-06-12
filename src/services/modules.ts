/**
 * Data-module store + loader (WS-E Layer 1).
 *
 * Discovers parquet "data modules" under the modules root (default
 * `~/.jurisd/modules/`), validates each module's `manifest.json` against the
 * vendored schema, and exposes an in-memory registry of metadata only — no
 * parquet bytes, no embeddings are held in RSS. DuckDB is attached lazily
 * per-module on first query, mirroring the graceful-degrade lazy-import pattern
 * of `oalc.ts`.
 *
 * Design: docs/design/data-layer.md §1.
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
