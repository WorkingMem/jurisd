/**
 * Data-module manifest types + a dependency-light validator.
 *
 * The manifest schema is vendored at `src/data/manifest.schema.json` (a copy of
 * the canonical `jurisd-data/manifest.schema.json`). Validation runs with no
 * network and no sibling-repo dependency: it uses `ajv` when present and falls
 * back to a hand-rolled structural check otherwise, so the loader never throws
 * because of a missing dev dependency.
 */
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
export declare const IMPLEMENTED_SCHEMA_VERSION = 1;
/** Module names must be safe SQL identifiers and safe path segments. */
export declare const MODULE_NAME_PATTERN: RegExp;
/**
 * A `files[].path` must be a safe relative path: one or more dot/dash/underscore
 * segments separated by `/`, each segment starting with an alphanumeric. This
 * forbids absolute paths, `..` traversal, leading slashes, backslashes, and NUL —
 * the manifest is fetched from a remote (Hugging Face) and an unconstrained path
 * is a zip-slip-equivalent arbitrary-file-write/read vector (see
 * `fetchModule`/`verifyModule`).
 */
export declare const SAFE_MODULE_FILE_PATH: RegExp;
/** True when `p` is a safe relative module file path (see {@link SAFE_MODULE_FILE_PATH}). */
export declare function isSafeModuleFilePath(p: unknown): p is string;
/**
 * Validate a parsed manifest object against the vendored schema.
 *
 * Uses ajv when available; otherwise a structural fallback that enforces the
 * required top-level shape. Never throws — returns a typed result.
 */
export declare function validateManifest(data: unknown): ValidationResult;
//# sourceMappingURL=manifest.d.ts.map