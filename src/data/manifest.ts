/**
 * Data-module manifest types + a dependency-light validator.
 *
 * The manifest schema is vendored at `src/data/manifest.schema.json` (a copy of
 * the canonical `jurisd-data/manifest.schema.json`). Validation runs with no
 * network and no sibling-repo dependency: it uses `ajv` when present and falls
 * back to a hand-rolled structural check otherwise, so the loader never throws
 * because of a missing dev dependency.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** The embedding descriptor, or null for an unembedded module. */
export interface EmbeddingDescriptor {
  model_id: string;
  dim: number;
  normalised: boolean;
}

/** One parquet file's integrity record. */
export interface ManifestFile {
  path: string;
  sha256: string;
  rows: number;
}

/** A single per-source licence verdict. */
export interface PerSourceLicence {
  source: string;
  licence: string;
  redistributable: boolean;
  evidence_url: string;
}

/** The reproducibility snapshot record. */
export interface ManifestSnapshot {
  date: string;
  recipe_repo: string;
  recipe_git_sha: string;
  args: Record<string, unknown>;
  corpus_sha?: string;
  dataset?: string;
  revision?: string;
}

/** A parsed + validated module manifest (schema_version 1). */
export interface Manifest {
  name: string;
  module_version: string;
  schema_version: number;
  yanked: boolean;
  base_uri: string;
  snapshot: ManifestSnapshot;
  coverage: {
    jurisdictions: string[];
    types: string[];
    doc_count: number;
    chunk_count: number;
  };
  embedding: EmbeddingDescriptor | null;
  files: ManifestFile[];
  licence: {
    spdx: string;
    per_source: PerSourceLicence[];
    attribution: string[];
  };
}

/** Result of validating a manifest object against the vendored schema. */
export interface ValidationResult {
  valid: boolean;
  /** First validation error (human-readable) when invalid. */
  error?: string;
}

/** The schema version this loader implements (MODULE_SPEC §"Conformance"). */
export const IMPLEMENTED_SCHEMA_VERSION = 1;

/** Module names must be safe SQL identifiers and safe path segments. */
export const MODULE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

let _schema: object | null = null;

function loadSchema(): object {
  if (_schema) return _schema;
  // resolveJsonModule + NodeNext: import the vendored JSON synchronously.
  _schema = require("./manifest.schema.json") as object;
  return _schema;
}

/**
 * Try to construct an ajv validator. Returns null when ajv is not installed,
 * so validation degrades to the hand-rolled check rather than throwing.
 */
function tryGetAjvValidator(): ((data: unknown) => ValidationResult) | null {
  try {
    // ajv is a common transitive dependency; require lazily so its absence is
    // non-fatal (mirrors the optional-dependency posture of the rest of the data layer).
    const AjvModule = require("ajv") as { default?: unknown } | unknown;
    const Ajv = (
      typeof AjvModule === "function" ? AjvModule : (AjvModule as { default: unknown }).default
    ) as new (opts?: object) => {
      compile: (schema: object) => ((data: unknown) => boolean) & {
        errors?: Array<{ instancePath?: string; message?: string }> | null;
      };
    };
    const ajv = new Ajv({ allErrors: false, strict: false });
    const validate = ajv.compile(loadSchema());
    return (data: unknown): ValidationResult => {
      const ok = validate(data);
      if (ok) return { valid: true };
      const first = validate.errors?.[0];
      const where = first?.instancePath || "(root)";
      return { valid: false, error: `${where} ${first?.message ?? "is invalid"}`.trim() };
    };
  } catch {
    return null;
  }
}

let _ajvValidator: ((data: unknown) => ValidationResult) | null | undefined;

/**
 * Validate a parsed manifest object against the vendored schema.
 *
 * Uses ajv when available; otherwise a structural fallback that enforces the
 * required top-level shape. Never throws — returns a typed result.
 */
export function validateManifest(data: unknown): ValidationResult {
  if (_ajvValidator === undefined) _ajvValidator = tryGetAjvValidator();
  if (_ajvValidator) return _ajvValidator(data);
  return structuralValidate(data);
}

/** A small, dependency-free structural check used when ajv is absent. */
function structuralValidate(data: unknown): ValidationResult {
  if (typeof data !== "object" || data === null) {
    return { valid: false, error: "(root) manifest must be an object" };
  }
  const m = data as Record<string, unknown>;
  const requireString = (k: string): string | undefined =>
    typeof m[k] === "string" && (m[k] as string).length > 0
      ? undefined
      : `${k} must be a non-empty string`;

  for (const k of ["name", "module_version", "base_uri"]) {
    const err = requireString(k);
    if (err) return { valid: false, error: err };
  }
  if (typeof m.schema_version !== "number" || !Number.isInteger(m.schema_version)) {
    return { valid: false, error: "schema_version must be an integer" };
  }
  if (typeof m.yanked !== "boolean") {
    return { valid: false, error: "yanked must be a boolean" };
  }
  if (typeof m.coverage !== "object" || m.coverage === null) {
    return { valid: false, error: "coverage must be an object" };
  }
  const cov = m.coverage as Record<string, unknown>;
  if (!Array.isArray(cov.jurisdictions) || cov.jurisdictions.length === 0) {
    return { valid: false, error: "coverage.jurisdictions must be a non-empty array" };
  }
  if (!Array.isArray(cov.types) || cov.types.length === 0) {
    return { valid: false, error: "coverage.types must be a non-empty array" };
  }
  if (!Array.isArray(m.files) || m.files.length === 0) {
    return { valid: false, error: "files must be a non-empty array" };
  }
  for (const f of m.files as unknown[]) {
    const file = f as Record<string, unknown>;
    if (typeof file.path !== "string" || typeof file.sha256 !== "string") {
      return { valid: false, error: "files[].path and files[].sha256 are required" };
    }
    if (!/^[a-f0-9]{64}$/.test(file.sha256)) {
      return { valid: false, error: `files[].sha256 must be lowercase hex sha256 (${file.path})` };
    }
  }
  if (m.embedding !== null && (typeof m.embedding !== "object" || m.embedding === null)) {
    return { valid: false, error: "embedding must be an object or null" };
  }
  if (m.embedding !== null) {
    const e = m.embedding as Record<string, unknown>;
    if (
      typeof e.model_id !== "string" ||
      typeof e.dim !== "number" ||
      typeof e.normalised !== "boolean"
    ) {
      return { valid: false, error: "embedding must have model_id, dim, normalised" };
    }
  }
  if (typeof m.licence !== "object" || m.licence === null) {
    return { valid: false, error: "licence must be an object" };
  }
  return { valid: true };
}
