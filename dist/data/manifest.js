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
import path from "node:path";
const require = createRequire(import.meta.url);
/** The schema version this loader implements (MODULE_SPEC §"Conformance"). */
export const IMPLEMENTED_SCHEMA_VERSION = 1;
/** Module names must be safe SQL identifiers and safe path segments. */
export const MODULE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
/**
 * A `files[].path` must be a safe relative path: one or more dot/dash/underscore
 * segments separated by `/`, each segment starting with an alphanumeric. This
 * forbids absolute paths, `..` traversal, leading slashes, backslashes, and NUL —
 * the manifest is fetched from a remote (Hugging Face) and an unconstrained path
 * is a zip-slip-equivalent arbitrary-file-write/read vector (see
 * `fetchModule`/`verifyModule`).
 */
export const SAFE_MODULE_FILE_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
/** True when `p` is a safe relative module file path (see {@link SAFE_MODULE_FILE_PATH}). */
export function isSafeModuleFilePath(p) {
    if (typeof p !== "string" || p.length === 0 || p.length > 255)
        return false;
    if (p.includes("\0") || p.includes("..") || p.includes("\\"))
        return false;
    if (path.isAbsolute(p))
        return false;
    return SAFE_MODULE_FILE_PATH.test(p);
}
/** Keys whose presence in a parsed manifest indicates a prototype-pollution attempt. */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
/**
 * Recursively detect a `__proto__`/`constructor`/`prototype` key in a parsed
 * (remote) manifest object. `JSON.parse` materialises these as own enumerable
 * properties, so `Object.entries` sees them; reject rather than risk a later
 * merge/spread polluting `Object.prototype`.
 */
function hasDangerousKey(value, depth = 0) {
    if (depth > 8 || value === null || typeof value !== "object")
        return false;
    for (const [k, v] of Object.entries(value)) {
        if (DANGEROUS_KEYS.has(k))
            return true;
        if (hasDangerousKey(v, depth + 1))
            return true;
    }
    return false;
}
let _schema = null;
function loadSchema() {
    if (_schema)
        return _schema;
    // resolveJsonModule + NodeNext: import the vendored JSON synchronously.
    _schema = require("./manifest.schema.json");
    return _schema;
}
/**
 * Try to construct an ajv validator. Returns null when ajv is not installed,
 * so validation degrades to the hand-rolled check rather than throwing.
 */
function tryGetAjvValidator() {
    try {
        // ajv is a common transitive dependency; require lazily so its absence is
        // non-fatal (mirrors the optional-dependency posture of the rest of the data layer).
        const AjvModule = require("ajv");
        const Ajv = (typeof AjvModule === "function" ? AjvModule : AjvModule.default);
        const ajv = new Ajv({ allErrors: false, strict: false });
        const validate = ajv.compile(loadSchema());
        return (data) => {
            const ok = validate(data);
            if (ok)
                return { valid: true };
            const first = validate.errors?.[0];
            const where = first?.instancePath || "(root)";
            return { valid: false, error: `${where} ${first?.message ?? "is invalid"}`.trim() };
        };
    }
    catch {
        return null;
    }
}
let _ajvValidator;
/**
 * Validate a parsed manifest object against the vendored schema.
 *
 * Uses ajv when available; otherwise a structural fallback that enforces the
 * required top-level shape. Never throws — returns a typed result.
 */
export function validateManifest(data) {
    if (_ajvValidator === undefined)
        _ajvValidator = tryGetAjvValidator();
    if (_ajvValidator)
        return _ajvValidator(data);
    return structuralValidate(data);
}
/** A small, dependency-free structural check used when ajv is absent. */
function structuralValidate(data) {
    if (typeof data !== "object" || data === null) {
        return { valid: false, error: "(root) manifest must be an object" };
    }
    const m = data;
    if (hasDangerousKey(m)) {
        return {
            valid: false,
            error: "manifest contains a forbidden key (__proto__/constructor/prototype)",
        };
    }
    const requireString = (k) => typeof m[k] === "string" && m[k].length > 0
        ? undefined
        : `${k} must be a non-empty string`;
    for (const k of ["name", "module_version", "base_uri"]) {
        const err = requireString(k);
        if (err)
            return { valid: false, error: err };
    }
    // base_uri resolves files[].path; it must be an absolute HTTPS URL so a hostile
    // manifest cannot point asset fetches at file:/data:/javascript: or plain HTTP.
    let baseUrl;
    try {
        baseUrl = new URL(m.base_uri);
    }
    catch {
        return { valid: false, error: "base_uri must be a valid absolute URL" };
    }
    if (baseUrl.protocol !== "https:") {
        return { valid: false, error: `base_uri must use https (got ${baseUrl.protocol})` };
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
    const cov = m.coverage;
    if (!Array.isArray(cov.jurisdictions) || cov.jurisdictions.length === 0) {
        return { valid: false, error: "coverage.jurisdictions must be a non-empty array" };
    }
    if (!Array.isArray(cov.types) || cov.types.length === 0) {
        return { valid: false, error: "coverage.types must be a non-empty array" };
    }
    if (!Array.isArray(m.files) || m.files.length === 0) {
        return { valid: false, error: "files must be a non-empty array" };
    }
    for (const f of m.files) {
        const file = f;
        if (typeof file.path !== "string" || typeof file.sha256 !== "string") {
            return { valid: false, error: "files[].path and files[].sha256 are required" };
        }
        if (!isSafeModuleFilePath(file.path)) {
            return {
                valid: false,
                error: `files[].path '${String(file.path)}' is not a safe relative path`,
            };
        }
        if (!/^[a-f0-9]{64}$/.test(file.sha256)) {
            return { valid: false, error: `files[].sha256 must be lowercase hex sha256 (${file.path})` };
        }
    }
    if (m.embedding !== null && (typeof m.embedding !== "object" || m.embedding === null)) {
        return { valid: false, error: "embedding must be an object or null" };
    }
    if (m.embedding !== null) {
        const e = m.embedding;
        if (typeof e.model_id !== "string" ||
            typeof e.dim !== "number" ||
            typeof e.normalised !== "boolean") {
            return { valid: false, error: "embedding must have model_id, dim, normalised" };
        }
    }
    if (typeof m.licence !== "object" || m.licence === null) {
        return { valid: false, error: "licence must be an object" };
    }
    return { valid: true };
}
//# sourceMappingURL=manifest.js.map