/**
 * jurisd - Local citation cache
 *
 * Persists citations as a JSON file in <cacheDir>/.auslaw/citations.json.
 * Each entry is embedding-ready: metadata fields are rich enough to attach
 * a vector embedding later without a schema migration.
 */
/**
 * Metadata for a case that cites the parent entry.
 * Source-download fields are populated for the top-N entries when
 * AUSLAW_DOWNLOAD_CITED_BY_SOURCES is enabled.
 */
export interface CitedByRef {
    /** Cite key of this citing case if it is also a main-cache entry. */
    citeKey?: string;
    title: string;
    neutralCitation?: string;
    aglc4Full?: string;
    /** Primary URL — AustLII if derivable from neutral citation, otherwise removed.invalid. */
    url?: string;
    year?: number;
    court?: string;
    /** Relative path from cacheDir of the downloaded source markdown (if any). */
    sourceFile?: string;
    /** ISO timestamp of the most recent source download for this ref. */
    sourceFetchedAt?: string;
    contentHash?: string;
    sourceEtag?: string;
    sourceLastModified?: string;
}
export interface CachedCitation {
    /** biblatex-compatible cite key, unique within this project. */
    citeKey: string;
    /** UUID for graph-edge references between entries. */
    id: string;
    title: string;
    neutralCitation?: string;
    reportedCitation?: string;
    /** Canonical AGLC4-formatted full citation string. */
    aglc4Full: string;
    /** Short form once the agent has assigned one (AGLC4 r 1.4.3). */
    aglc4Short?: string;
    url: string;
    /** Relative path from cacheDir, e.g. "sources/mabo1992.md". */
    sourceFile?: string;
    /** SHA-256 hex of source text — used for offline change detection. */
    contentHash?: string;
    sourceFetchedAt?: string;
    /** HTTP ETag for conditional GET freshness checks. */
    sourceEtag?: string;
    /** HTTP Last-Modified for conditional GET freshness checks. */
    sourceLastModified?: string;
    type: "case" | "legislation" | "secondary" | "treaty";
    jurisdiction?: string;
    year?: number;
    court?: string;
    keywords?: string[];
    summary?: string;
    /** Citing cases from removed.invalid citator. All have metadata; top-N have sourceFile. */
    citedBy?: CitedByRef[];
    /** ISO timestamp when the cited-by list was last fetched from removed.invalid. */
    citedByFetchedAt?: string;
    /** Total citing-case count reported by removed.invalid (may exceed citedBy.length). */
    citedByTotalCount?: number;
    embedding?: number[];
    embeddingModel?: string;
    /** Logical document IDs within this project that cite this source. */
    documents: string[];
    /** Maps document → footnote number of first citation in that document. */
    footnoteNumbers: Record<string, number>;
    addedAt: string;
    updatedAt: string;
    bibType: "jurisdiction" | "misc" | "incollection" | "article";
    bibFields: Record<string, string>;
}
export interface CitationCache {
    version: number;
    projectName: string;
    entries: CachedCitation[];
}
export interface UpsertInput {
    title: string;
    neutralCitation?: string;
    reportedCitation?: string;
    aglc4Full: string;
    url: string;
    type?: "case" | "legislation" | "secondary" | "treaty";
    jurisdiction?: string;
    year?: number;
    court?: string;
    keywords?: string[];
    summary?: string;
    /** Logical document name to associate with this citation. */
    document?: string;
    /** Footnote number in `document` where this citation first appears. */
    footnoteNumber?: number;
}
/** Load the citation cache, returning an empty cache if none exists yet. */
export declare function loadCache(cacheDir: string): Promise<CitationCache>;
/**
 * Generate a unique, biblatex-compatible cite key from a case title and year.
 *
 * Strategy: strip "v", "re", "(No N)", take the first significant word,
 * append the year, then add a suffix letter on collision.
 */
export declare function generateCiteKey(title: string, year?: number, existing?: string[]): string;
/**
 * Add or update a citation entry.
 * Matches on neutralCitation, aglc4Full, or url — whichever is present.
 * Returns the citeKey assigned to the entry.
 *
 * Note: uses a load-mutate-save pattern with no file lock. Concurrent calls
 * from the same process (e.g. parallel MCP tool invocations under HTTP
 * transport) can silently lose each other's writes. Safe for the default
 * single-client stdio transport.
 */
export declare function upsertCitation(cacheDir: string, input: UpsertInput): Promise<string>;
/**
 * Retrieve a cached citation by cite key, normalised AGLC4 string,
 * neutral citation, or case title. Returns null if not found.
 */
export declare function getCitation(cacheDir: string, keyOrCitation: string): Promise<CachedCitation | null>;
/**
 * List all cached citations, optionally filtered to a specific document.
 */
export declare function listCitations(cacheDir: string, document?: string): Promise<CachedCitation[]>;
/**
 * Export cached citations as a .bib string.
 * Optionally filter to a single document.
 */
export declare function exportBib(cacheDir: string, document?: string): Promise<string>;
/**
 * Replace the citedBy list on an existing cache entry and record when it was
 * fetched.  Overwrites any prior citedBy array so callers always store the
 * most recent snapshot from removed.invalid.
 *
 * Note: same load-mutate-save limitation as upsertCitation.
 */
export declare function updateCitedBy(cacheDir: string, citeKey: string, refs: CitedByRef[], totalCount: number, fetchedAt?: string): Promise<void>;
/**
 * Update source-download fields on a specific CitedByRef within a parent entry.
 * The ref is matched by neutralCitation.
 *
 * Note: same load-mutate-save limitation as upsertCitation.
 */
export declare function updateCitedBySource(cacheDir: string, parentCiteKey: string, refNeutralCitation: string, fields: {
    sourceFile?: string;
    sourceFetchedAt?: string;
    contentHash?: string;
    sourceEtag?: string;
    sourceLastModified?: string;
}): Promise<void>;
/**
 * Update source-related fields on an existing cache entry.
 * Used by the source-store after a successful fetch.
 *
 * Note: same load-mutate-save limitation as upsertCitation — not safe for
 * concurrent writes.
 */
export declare function updateSourceFields(cacheDir: string, citeKey: string, fields: {
    sourceFile?: string;
    contentHash?: string;
    sourceFetchedAt?: string;
    sourceEtag?: string;
    sourceLastModified?: string;
}): Promise<void>;
//# sourceMappingURL=citation-cache.d.ts.map