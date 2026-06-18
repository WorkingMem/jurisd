/**
 * OALC (Open Australian Legal Corpus) DuckDB seam.
 *
 * The OALC corpus is a local JSONL file (~8.8 GB) at
 * `~/oalc-data/corpus_published.jsonl` (default; override with
 * AUSLAW_OALC_SOURCE). Each line is a JSON object with the schema:
 *
 *   version_id, type, jurisdiction, source, mime, date, citation,
 *   url, when_scraped, text
 *
 * This module provides two lookup functions that query the corpus via
 * DuckDB's `read_json_auto` / JSONL scanning without loading the whole
 * file into memory:
 *
 *   - {@link lookupByUrl}   — find a document by its canonical URL
 *   - {@link lookupByCitation} — find a document by its citation string
 *
 * Both return an {@link OalcDocument} or null when not found.
 *
 * The DuckDB connection is created lazily on first use and cached for the
 * lifetime of the process. It is intentionally in-memory (`:memory:`) since
 * we only scan the JSONL; we do not persist any derived tables here.
 *
 * The module degrades gracefully when @duckdb/node-api is not installed:
 * both lookup functions return null and a one-time warning is logged.
 */
/** A single document record from the OALC corpus. */
export interface OalcDocument {
    version_id: string;
    type: string;
    jurisdiction: string;
    source: string;
    mime: string;
    date: string;
    citation: string;
    url: string;
    when_scraped: string;
    text: string;
}
/**
 * Look up a document in the OALC corpus by its canonical URL.
 *
 * @param url - Canonical URL of the document (e.g. an AustLII judgment URL).
 * @returns The matching {@link OalcDocument} or null when not found or DuckDB
 *          is unavailable.
 */
export declare function lookupByUrl(url: string): Promise<OalcDocument | null>;
/**
 * Look up a document in the OALC corpus by its citation string.
 *
 * Two modes:
 *   - Full citation (default): exact, case-sensitive match. Callers should
 *     normalise the citation before passing it in for case-insensitive matching.
 *   - Neutral-citation token (e.g. `"[1992] HCA 23"`): when `isLegis` is
 *     supplied the match is a substring (`citation LIKE '%<token>%'`), because
 *     the corpus stores decisions as `"Case Name [1992] HCA 23"`. The neutral
 *     citation is the only stable join key from an AustLII URL. For decisions
 *     the result is further constrained to `type = 'decision'` to guard against
 *     a wrong-type match; legislation passes `isLegis = true` to drop that
 *     constraint.
 *
 * @param citation - Full citation string or a neutral-citation token.
 * @param isLegis - When provided, switches to substring matching and tunes the
 *                  `type` filter (true = legislation, false = decision).
 * @returns The matching {@link OalcDocument} or null when not found or DuckDB
 *          is unavailable.
 */
export declare function lookupByCitation(citation: string, isLegis?: boolean): Promise<OalcDocument | null>;
/**
 * Close and reset the cached DuckDB connection.
 * Primarily useful in tests to reset module state between runs.
 */
export declare function resetConnection(): void;
//# sourceMappingURL=oalc.d.ts.map