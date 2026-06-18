/**
 * jurisd - Source store
 *
 * Downloads and persists source documents as local markdown files.
 * Uses HTTP ETag / Last-Modified for conditional-GET freshness checks so that
 * re-fetching skips the network when the primary source has not changed.
 */
export interface FreshnessResult {
    /** True when the server confirmed the local copy is current (HTTP 304). */
    fresh: boolean;
    /** ETag from the server response (may be updated even on 304). */
    etag?: string;
    /** Last-Modified from the server response. */
    lastModified?: string;
}
export interface StoreSourceResult {
    /** Absolute path of the written (or already-current) file. */
    path: string;
    /** True when the file content was updated or created during this call. */
    changed: boolean;
    etag?: string;
    lastModified?: string;
    contentHash: string;
}
/**
 * Issue a conditional HEAD request to check whether the local copy of a
 * source document is still current.
 *
 * Returns `fresh: true` (HTTP 304) or `fresh: false` (HTTP 200 / error).
 * Network errors are treated as stale so the caller falls back to re-fetching.
 */
export declare function checkSourceFreshness(url: string, etag?: string, lastModified?: string): Promise<FreshnessResult>;
/**
 * Download a source document and save it as a markdown file under `sourcesDir`.
 *
 * Freshness check flow:
 * 1. If `cached` provides ETag/Last-Modified, issue a conditional HEAD first.
 *    HTTP 304 → local copy is current; return without re-downloading.
 * 2. Otherwise fetch full content, compute SHA-256, compare to `cached.contentHash`.
 *    Only write to disk when the hash differs.
 * 3. Issue a follow-up HEAD to capture current ETag/Last-Modified for the
 *    next freshness check (skipped when the primary URL does not return them).
 *
 * @returns Path of the file, whether it changed, and HTTP cache headers.
 */
export declare function storeSource(citeKey: string, url: string, cached: {
    contentHash?: string;
    sourceEtag?: string;
    sourceLastModified?: string;
} | null, sourcesDir: string, prefetchedDoc?: {
    text: string;
    etag?: string;
    lastModified?: string;
}): Promise<StoreSourceResult>;
//# sourceMappingURL=source-store.d.ts.map