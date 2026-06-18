import type { SearchResult, SearchOptions } from "./austlii.js";
import { type CitingCase } from "./jade-gwt.js";
export type { CitingCase };
/**
 * jade.io integration service
 *
 * jade.io (BarNet Jade) is an Australian legal research platform providing
 * judgments, decisions, and statutes. It does not expose a public search API,
 * so this service provides:
 *
 * 1. Article metadata resolution from jade.io article URLs
 * 2. Citation-based jade.io URL construction
 * 3. Cross-referencing AustLII results with jade.io article links
 * 4. jade.io URL detection and normalization
 *
 * Search is not available as jade.io uses a GWT single-page application
 * with no server-rendered results or public REST API.
 */
export interface JadeArticle {
    /** jade.io article numeric ID */
    id: number;
    /** Case/legislation title extracted from page metadata */
    title: string;
    /** Neutral citation if present, e.g. "[2008] NSWSC 323" */
    neutralCitation?: string;
    /** Jurisdiction code extracted from citation, e.g. "nsw" */
    jurisdiction?: string;
    /** Year extracted from citation */
    year?: string;
    /** Full canonical URL on jade.io */
    url: string;
    /** Whether the article appears to be accessible (title was resolved) */
    accessible: boolean;
}
/**
 * Checks whether a URL belongs to jade.io
 */
export declare function isJadeUrl(url: string): boolean;
/**
 * Extracts article ID from a jade.io URL
 * Supports patterns:
 *   - https://jade.io/article/12345
 *   - https://jade.io/j/?a=outline&id=12345
 *   - https://jade.io/article/12345/some/path
 */
export declare function extractArticleId(url: string): number | undefined;
/**
 * Constructs the canonical jade.io article URL for a given article ID
 */
export declare function buildArticleUrl(articleId: number): string;
/**
 * Constructs a jade.io search URL for a given query.
 * Note: This URL opens jade.io's SPA with the search pre-filled.
 * It does NOT return machine-readable results.
 */
export declare function buildSearchUrl(query: string): string;
/**
 * Extracts neutral citation from a jade.io page title.
 * jade.io titles follow the pattern: "Case Name [YYYY] COURT NUM - BarNet Jade"
 */
export declare function parseTitleMetadata(rawTitle: string): {
    title: string;
    neutralCitation?: string;
    jurisdiction?: string;
    year?: string;
};
/**
 * Extracts jurisdiction from a court abbreviation
 */
export declare function getJurisdictionFromCourt(court: string): string | undefined;
/**
 * Resolves metadata for a jade.io article by fetching the page and
 * extracting information from the HTML <title> tag.
 *
 * jade.io renders content via GWT (client-side JavaScript), but the
 * initial HTML includes the case title in the <title> element, giving
 * us the case name and neutral citation without needing JavaScript
 * execution.
 *
 * @param articleId - Numeric jade.io article ID
 * @returns Resolved article metadata, or article with accessible=false
 */
export declare function resolveArticle(articleId: number): Promise<JadeArticle>;
/**
 * Resolves metadata for a jade.io article from its URL.
 * Extracts the article ID from the URL and resolves it.
 */
export declare function resolveArticleFromUrl(url: string): Promise<JadeArticle | undefined>;
/**
 * Converts a resolved jade.io article into a SearchResult.
 * Used when cross-referencing AustLII results with jade.io.
 */
export declare function articleToSearchResult(article: JadeArticle, type: "case" | "legislation"): SearchResult;
/**
 * Attempts to find a jade.io article for a given neutral citation.
 * Since jade.io has no search API, this constructs a search URL
 * that the user can open, and returns metadata about the lookup.
 *
 * @param citation - Neutral citation string, e.g. "[2008] NSWSC 323"
 * @returns Search URL the user can use to find the article on jade.io
 */
export declare function buildCitationLookupUrl(citation: string): string;
/**
 * Enriches AustLII search results with jade.io links where possible.
 * For each result with a neutral citation, constructs a jade.io search URL.
 *
 * @param results - AustLII search results
 * @returns Results with jadeUrl added where applicable
 */
export declare function enrichWithJadeLinks(results: SearchResult[]): Array<SearchResult & {
    jadeUrl?: string;
}>;
/**
 * Searches jade.io using the proposeCitables GWT-RPC method.
 *
 * proposeCitables is jade.io's internal search/autocomplete endpoint, reverse-engineered
 * from HAR analysis (2026-03-03). It returns case names, neutral citations, reported
 * citations, and jade.io article IDs in a single response.
 *
 * Requires JADE_SESSION_COOKIE. Returns an empty array (graceful degradation) if the
 * cookie is not configured or if the request fails — jade search failure should not
 * prevent AustLII results from being returned.
 *
 * @param query - Search query string
 * @param options - Search options (type, jurisdiction, limit, etc.)
 * @returns Array of SearchResult objects, empty if search fails or cookie is missing
 */
export declare function searchJade(query: string, options: SearchOptions): Promise<SearchResult[]>;
/**
 * Fetches the full HTML content of a jade.io article via the GWT-RPC API.
 *
 * Calls ArticleViewRemoteService.avd2Request() directly, bypassing the GWT
 * JavaScript client. This requires a valid authenticated session cookie.
 *
 * The avd2Request method (discovered via SPA navigation interception, 2026-03-02)
 * is the primary content-loading method used by jade.io's GWT app. It reliably
 * returns full article HTML including paragraph anchors (bnj_a_{id}_sr_{N}).
 *
 * Note: the earlier getInitialContent method (captured via Proxyman HAR) returns
 * empty body when called directly, likely due to server-side session state
 * requirements that avd2Request does not have.
 *
 * @param articleId - Numeric jade.io article ID
 * @param sessionCookie - Full Cookie header value from an authenticated session,
 *   e.g. `IID=...; alcsessionid=...; cf_clearance=...`
 *   Obtain via DevTools: Network tab > any jade.io request > Request Headers > Cookie.
 * @returns Raw HTML content string
 * @throws Error if the request fails or the GWT-RPC response indicates an exception
 */
export declare function fetchJadeArticleContent(articleId: number, sessionCookie: string): Promise<string>;
/**
 * Returns { results, totalCount } for `searchCitingCases` calls.
 */
export interface CitatorSearchResult {
    results: CitingCase[];
    /** Total number of citing cases in jade.io (results is a subset) */
    totalCount: number;
}
/**
 * Finds cases that cite the given case name on jade.io.
 *
 * ## Flow
 * 1. Search `proposeCitables` to find the case and extract its citable ID
 * 2. Use the citable ID to call `LeftoverRemoteService.search` (citator)
 * 3. Parse the citator response and return citing cases with totalCount
 *
 * Requires JADE_SESSION_COOKIE. Returns empty results (graceful degradation)
 * if the cookie is not configured or any request fails.
 *
 * @param caseName - Case name or citation to look up (passed to proposeCitables)
 * @returns Citing cases found on jade.io, plus the total count
 */
export declare function searchCitingCases(caseName: string): Promise<CitatorSearchResult>;
//# sourceMappingURL=jade.d.ts.map