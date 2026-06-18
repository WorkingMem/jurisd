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
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { config } from "../config.js";
import { IMPLEMENTED_SCHEMA_VERSION, MODULE_NAME_PATTERN, isSafeModuleFilePath, validateManifest, } from "../data/manifest.js";
/**
 * Hosts a module manifest and its parquet assets may be fetched from. Modules
 * are published as Hugging Face datasets; large files are served via a 302 to
 * the HF LFS CDN (`cdn-lfs*.huggingface.co` / `*.hf.co`), so the allowlist is
 * the HF domain families. This is the SSRF guard for the module-fetch path:
 * neither an operator-supplied `--manifest-url` nor a hostile manifest
 * `base_uri` may point fetches at internal/metadata addresses.
 */
const MODULE_ALLOWED_HOSTS = new Set(["huggingface.co", "hf.co"]);
const MODULE_ALLOWED_HOST_SUFFIXES = [".huggingface.co", ".hf.co"];
/** Bounded redirect chain for module asset fetches (HF resolve -> LFS CDN). */
const MODULE_MAX_REDIRECTS = 5;
/** Assert a module URL is HTTPS on an allowed Hugging Face host. Throws otherwise. */
export function assertModuleUrl(raw) {
    let u;
    try {
        u = new URL(raw);
    }
    catch {
        throw new Error(`invalid module URL: ${raw}`);
    }
    if (u.protocol !== "https:") {
        throw new Error(`module URL must use https (got ${u.protocol}): ${raw}`);
    }
    const host = u.hostname.toLowerCase();
    const allowed = MODULE_ALLOWED_HOSTS.has(host) || MODULE_ALLOWED_HOST_SUFFIXES.some((s) => host.endsWith(s));
    if (!allowed) {
        throw new Error(`module host '${host}' is not an allowed Hugging Face host`);
    }
}
/**
 * Fetch a module URL, re-validating the host on every redirect hop. Uses
 * `redirect: "manual"` so an allowlisted HF URL cannot 302 us to an internal
 * address (DNS-rebind / open-redirect SSRF); each hop must itself be an allowed
 * HF host.
 */
async function secureModuleFetch(url) {
    let current = url;
    for (let hop = 0; hop <= MODULE_MAX_REDIRECTS; hop++) {
        assertModuleUrl(current);
        const res = await fetch(current, { redirect: "manual" });
        if (res.status >= 300 && res.status < 400) {
            const location = res.headers.get("location");
            if (!location)
                return res;
            current = new URL(location, current).toString();
            continue;
        }
        return res;
    }
    throw new Error(`too many redirects while fetching ${url}`);
}
/** The default IO backed by global fetch. */
export const defaultIO = {
    async fetchBytes(url) {
        const res = await secureModuleFetch(url);
        if (!res.ok)
            throw new Error(`GET ${url} -> HTTP ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
    },
    async fetchJson(url) {
        const res = await secureModuleFetch(url);
        if (!res.ok)
            throw new Error(`GET ${url} -> HTTP ${res.status}`);
        return res.json();
    },
};
/** Lowercase hex sha256 of a buffer. */
function sha256Hex(buf) {
    return crypto.createHash("sha256").update(buf).digest("hex");
}
/** Lowercase hex sha256 of a file on disk. */
function sha256File(file) {
    return sha256Hex(fs.readFileSync(file));
}
/** Join a base_uri and a relative file path (base_uri may or may not end in /). */
function resolveAsset(baseUri, relPath) {
    return baseUri.endsWith("/") ? `${baseUri}${relPath}` : `${baseUri}/${relPath}`;
}
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
export async function fetchModule(name, opts = {}) {
    const io = opts.io ?? defaultIO;
    const modulesDir = opts.modulesDir ?? config.modules.dir;
    if (!MODULE_NAME_PATTERN.test(name)) {
        return { ok: false, name, error: `module name '${name}' is not a safe identifier` };
    }
    const manifestUrl = opts.manifestUrl ??
        `https://huggingface.co/datasets/workingmem/${name}/resolve/main/manifest.json`;
    // 1-2. Resolve + validate the manifest before downloading any parquet.
    let manifestRaw;
    try {
        manifestRaw = await io.fetchJson(manifestUrl);
    }
    catch (err) {
        return { ok: false, name, error: `failed to fetch manifest: ${err.message}` };
    }
    const validation = validateManifest(manifestRaw);
    if (!validation.valid) {
        return { ok: false, name, error: `manifest failed schema validation: ${validation.error}` };
    }
    const manifest = manifestRaw;
    if (manifest.schema_version !== IMPLEMENTED_SCHEMA_VERSION) {
        return {
            ok: false,
            name,
            error: `manifest schema_version ${manifest.schema_version} is not implemented (loader implements ${IMPLEMENTED_SCHEMA_VERSION})`,
        };
    }
    if (manifest.yanked) {
        return { ok: false, name, error: `module '${name}' is yanked upstream; refusing to install` };
    }
    if (manifest.name !== name) {
        return {
            ok: false,
            name,
            error: `manifest name '${manifest.name}' does not match requested '${name}'`,
        };
    }
    // 3-4. Download each file to a temp dir and sha256-verify. Abort on mismatch.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `jurisd-fetch-${name}-`));
    try {
        // Persist the validated manifest alongside the parquet.
        fs.writeFileSync(path.join(tmpDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
        const tmpRoot = path.resolve(tmpDir);
        for (const file of manifest.files) {
            // Defence-in-depth: validateManifest already rejects unsafe paths, but
            // re-check at the write sink (the source-store.ts prefix-check pattern) so
            // a path can never escape the temp dir even if validation is bypassed.
            const destPath = path.resolve(tmpRoot, file.path);
            if (!isSafeModuleFilePath(file.path) || !destPath.startsWith(tmpRoot + path.sep)) {
                cleanup(tmpDir);
                return { ok: false, name, error: `unsafe file path in manifest: ${file.path}` };
            }
            const assetUrl = resolveAsset(manifest.base_uri, file.path);
            let bytes;
            try {
                bytes = await io.fetchBytes(assetUrl);
            }
            catch (err) {
                cleanup(tmpDir);
                return {
                    ok: false,
                    name,
                    error: `failed to download ${file.path}: ${err.message}`,
                };
            }
            const actual = sha256Hex(bytes);
            if (actual !== file.sha256) {
                cleanup(tmpDir);
                return {
                    ok: false,
                    name,
                    error: `sha256 mismatch for ${file.path}: expected ${file.sha256}, got ${actual}. ` +
                        `Refusing to install a partially-verified module.`,
                };
            }
            fs.writeFileSync(destPath, bytes);
        }
        // 5. Atomic install: temp-then-rename so a half-written module never appears.
        fs.mkdirSync(modulesDir, { recursive: true });
        const dest = path.join(modulesDir, name);
        const staging = `${dest}.staging-${process.pid}`;
        if (fs.existsSync(staging))
            fs.rmSync(staging, { recursive: true, force: true });
        fs.renameSync(tmpDir, staging);
        // Replace any prior version atomically.
        if (fs.existsSync(dest)) {
            const old = `${dest}.old-${process.pid}`;
            fs.renameSync(dest, old);
            fs.renameSync(staging, dest);
            fs.rmSync(old, { recursive: true, force: true });
        }
        else {
            fs.renameSync(staging, dest);
        }
        // 6. Surface the licence attribution lines at install.
        return { ok: true, name, installedPath: dest, attribution: manifest.licence.attribution };
    }
    finally {
        cleanup(tmpDir);
    }
}
/** Best-effort temp-dir cleanup. */
function cleanup(dir) {
    try {
        if (fs.existsSync(dir))
            fs.rmSync(dir, { recursive: true, force: true });
    }
    catch {
        // non-fatal
    }
}
/**
 * Re-verify an installed module's files against its manifest sha256 on demand
 * (the paranoid / CI path, design §5.3). Returns ok:false naming the first
 * mismatching file. Never throws.
 */
export function verifyModule(name, opts = {}) {
    const modulesDir = opts.modulesDir ?? config.modules.dir;
    const dir = path.join(modulesDir, name);
    const manifestPath = path.join(dir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
        return { ok: false, name, error: `module '${name}' is not installed at ${dir}` };
    }
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    }
    catch (err) {
        return { ok: false, name, error: `manifest.json unreadable: ${err.message}` };
    }
    const validation = validateManifest(manifest);
    if (!validation.valid) {
        return { ok: false, name, error: `manifest failed schema validation: ${validation.error}` };
    }
    const verifyRoot = path.resolve(dir);
    for (const file of manifest.files) {
        const filePath = path.resolve(verifyRoot, file.path);
        if (!isSafeModuleFilePath(file.path) || !filePath.startsWith(verifyRoot + path.sep)) {
            return { ok: false, name, error: `unsafe file path in manifest: ${file.path}` };
        }
        if (!fs.existsSync(filePath)) {
            return { ok: false, name, error: `missing file ${file.path}` };
        }
        const actual = sha256File(filePath);
        if (actual !== file.sha256) {
            return {
                ok: false,
                name,
                error: `sha256 mismatch for ${file.path}: expected ${file.sha256}, got ${actual}`,
            };
        }
    }
    return { ok: true, name, installedPath: dir, attribution: manifest.licence.attribution };
}
//# sourceMappingURL=fetch-module.js.map