export interface SearchResult {
    title: string;
    citation?: string;
    neutralCitation?: string;
    reportedCitation?: string;
    url: string;
    source: "austlii" | "jade";
    summary?: string;
    jurisdiction?: string;
    year?: string;
    type: "case" | "legislation";
}
export type Jurisdiction = "cth" | "vic" | "nsw" | "qld" | "sa" | "wa" | "tas" | "nt" | "act" | "federal" | "nz" | "other";
export type SearchMethod = "auto" | "title" | "phrase" | "all" | "any" | "near" | "legis" | "boolean";
export interface SearchOptions {
    jurisdiction?: Jurisdiction;
    limit?: number;
    type: "case" | "legislation";
    sortBy?: "relevance" | "date" | "auto";
    method?: SearchMethod;
    offset?: number;
}
export interface SearchParams {
    query: string;
    meta: string;
    mask_path?: string;
    method: string;
    offset?: number;
}
export declare function calculateAuthorityScore(result: SearchResult): number;
/**
 * Extracts reported citation from text.
 * Uses REPORTED_CITATION_PATTERNS from constants.
 */
export declare function extractReportedCitation(text: string): string | undefined;
/**
 * Detects if a query looks like a case name (e.g., "X v Y", "Re X")
 * These queries benefit from relevance sorting to find the specific case
 */
export declare function isCaseNameQuery(query: string): boolean;
/**
 * Determines the appropriate sort mode based on query and options
 */
export declare function determineSortMode(query: string, options: SearchOptions): "relevance" | "date";
export declare function buildSearchParams(query: string, options: SearchOptions): SearchParams;
/**
 * Searches AustLII for Australian and New Zealand case law or legislation.
 *
 * @param query - The search query string (case name, topic, or citation)
 * @param options - Search configuration options
 * @returns Promise resolving to an array of search results
 * @throws {Error} If the AustLII search request fails
 *
 * @example
 * ```typescript
 * const results = await searchAustLii("negligence duty of care", {
 *   type: "case",
 *   jurisdiction: "cth",
 *   limit: 10,
 * });
 * ```
 */
export declare function searchAustLii(query: string, options: SearchOptions): Promise<SearchResult[]>;
/**
 * Boosts results where the title closely matches the query
 * This helps prioritize the actual case being searched for
 */
export declare function boostTitleMatches(results: SearchResult[], query: string): SearchResult[];
//# sourceMappingURL=austlii.d.ts.map