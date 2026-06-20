/**
 * fetch-module: obtain + verify data modules.
 *
 * Modules are published as Hugging Face datasets under the workingmem org: the
 * four parquet files + manifest.json are the dataset files. The manifest's
 * `base_uri` points at the canonical asset location (the dataset resolve URL)
 * and `files[].sha256` is the integrity contract.
 *
 * This is an install-time / operator action driven by the CLI subcommand
 * (`jurisd fetch-module <name>`), NOT an MCP tool — keeping a multi-hundred-MB
 * download off the tool surface and out of an LLM's reach (design §5.1).
 *
 * The fetch flow validates the manifest against the vendored schema BEFORE
 * downloading any parquet (fail fast), sha256-verifies every file, and installs
 * atomically (temp-then-rename) so a half-written module never appears to the
 * loader. Because verification happens here, the load path trusts the hashes by
 * default (design §1.2 step 6), keeping startup fast.
 */
/** Assert a module URL is HTTPS on an allowed Hugging Face host. Throws otherwise. */
export declare function assertModuleUrl(raw: string): void;
/** Result of a fetch or verify operation. */
export interface FetchResult {
    ok: boolean;
    name: string;
    installedPath?: string;
    /** A typed, human-readable failure message when !ok. */
    error?: string;
    /** Licence attribution lines surfaced to the operator at install. */
    attribution?: string[];
}
/** Pluggable IO so unit tests mock the network without a live GitHub call. */
export interface FetchIO {
    /** Fetch a URL's bytes. Throws on a non-2xx or network error. */
    fetchBytes(url: string): Promise<Buffer>;
    /** Fetch + parse a JSON URL. Throws on a non-2xx, network, or parse error. */
    fetchJson(url: string): Promise<unknown>;
}
/** The default IO backed by global fetch. */
export declare const defaultIO: FetchIO;
/**
 * Fetch + verify + atomically install a module.
 *
 * Steps (design §5.2): resolve manifest, validate it against the vendored
 * schema + schema_version + yanked BEFORE any parquet download, download each
 * file, sha256-verify (and abort+cleanup on any mismatch), then temp-then-rename
 * into the modules dir. Never installs a partially-verified module.
 *
 * `manifestUrl` defaults to the canonical Hugging Face dataset location for
 * `name`; callers (and tests) may pass an explicit URL.
 */
export declare function fetchModule(name: string, opts?: {
    manifestUrl?: string;
    modulesDir?: string;
    io?: FetchIO;
}): Promise<FetchResult>;
/**
 * Re-verify an installed module's files against its manifest sha256 on demand
 * (the paranoid / CI path, design §5.3). Returns ok:false naming the first
 * mismatching file. Never throws.
 */
export declare function verifyModule(name: string, opts?: {
    modulesDir?: string;
}): FetchResult;
//# sourceMappingURL=fetch-module.d.ts.map