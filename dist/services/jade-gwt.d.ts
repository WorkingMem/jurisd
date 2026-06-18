/**
 * jade.io GWT-RPC utilities
 *
 * jade.io uses GWT-RPC (Google Web Toolkit Remote Procedure Call) as its
 * wire protocol. This module provides:
 *
 * - GWT integer encoding/decoding (custom base-64 used in serialised object IDs)
 * - Request body builders for article-content and search methods
 * - Response parsers that extract string payloads from //OK[...] envelopes
 *
 * ## GWT-RPC Services Discovered (from HAR analysis)
 *
 * ### JadeRemoteService (strong name: JADE_STRONG_NAME)
 * Methods: proposeCitables, searchArticles, getInitialContent,
 *          getArticleStructuredMetadata, loadTranches
 *
 * ### ArticleViewRemoteService (strong name: AVD2_STRONG_NAME)
 * Methods: avd2Request (primary content loader), getCitedPreview
 *
 * ### LeftoverRemoteService (strong name: LEFTOVER_STRONG_NAME)
 * Methods: search (citation search - "who cites this article", NOT freetext),
 *          getCitableCitations
 *
 * ## Search: proposeCitables
 *
 * proposeCitables (JadeRemoteService) is the ONLY method that returns full
 * search results in a single call. It powers jade.io's search/autocomplete box.
 * Returns case names, neutral citations, reported citations, article IDs, and
 * page pinpoints.
 *
 * - searchArticles returns only GWT-encoded article IDs (no case names)
 * - search (LeftoverRemoteService) is a citation search, not freetext
 *
 * ## Response Format
 *
 * All GWT-RPC responses follow: //OK[<flat_array>, <type_table>, <string_table>, 4, 7]
 * - String table is at parsed[parsed.length - 3]
 * - Negative integers in flat_array reference string_table: -N = string_table[N-1]
 * - GWT-encoded article IDs appear as strings in the string table
 *
 * ## Authentication
 *
 * All methods require JADE_SESSION_COOKIE (same for search and content fetch).
 *
 * ## Strong Name Staleness
 *
 * Strong names are GWT type hashes that may change when jade.io redeploys.
 * If requests return //EX exceptions, inspect the X-GWT-Permutation header
 * from a live browser session (DevTools > Network > any jadeService.do request).
 *
 * HAR sources:
 * - jade.io_03-02-2026-13-48-33.har: article 67401 navigation (first analysis)
 * - jade.io_03-03-2026-10-08-59.har: "Mabo" and "rice v as" searches (second analysis)
 */
/** jade.io GWT module base URL — part of the serialisation header */
export declare const JADE_MODULE_BASE = "https://jade.io/au.com.barnet.jade.JadeClient/";
/**
 * GWT-RPC strong name (type hash) for JadeRemoteService.
 * This may change when jade.io redeploys the GWT app.
 * If content fetching returns an exception response, this hash may need refreshing
 * by inspecting the X-GWT-Permutation header in a fresh browser session.
 * Last verified: 2026-06-13.
 */
export declare const JADE_STRONG_NAME = "F6E610452C7A15DE693DC8F95CF6849C";
/**
 * GWT-RPC strong name (type hash) for ArticleViewRemoteService.
 * This service handles article content loading via the avd2Request method.
 * Discovered via SPA navigation interception (2026-03-02). Last verified: 2026-06-13.
 */
export declare const AVD2_STRONG_NAME = "140B3EF36354F0C5A95299A70B18A25F";
/**
 * GWT permutation identifier for the Chrome/macOS compiled JS bundle.
 * Sent in the X-GWT-Permutation request header.
 * Different from JADE_STRONG_NAME - this identifies the browser-specific
 * JavaScript permutation, not the serialisation type hash.
 * Last verified: 2026-06-13.
 */
export declare const JADE_PERMUTATION = "9F7FA3DEE1E002939D47FA3D6C3F3DA1";
/**
 * GWT-RPC strong name (type hash) for LeftoverRemoteService.
 * This service handles citation-context searches ("who cites this article")
 * and citation data retrieval. NOT used for freetext case search.
 * Discovered from HAR analysis (2026-03-03). Last verified: 2026-06-13.
 */
export declare const LEFTOVER_STRONG_NAME = "C759183224A415CB53405469AC1B351C";
/**
 * Encodes a non-negative integer using GWT's custom base-64 charset.
 *
 * GWT represents integers in its RPC wire format using a compact base-64
 * encoding with the charset A-Z (0-25), a-z (26-51), 0-9 (52-61), $ (62), _ (63).
 *
 * Example: 67401 = 16*64² + 29*64 + 9 → 'Q' + 'd' + 'J' = "QdJ"
 *
 * @param n - Non-negative integer to encode
 * @returns GWT base-64 encoded string
 * @throws Error if n is negative or non-integer
 */
export declare function encodeGwtInt(n: number): string;
/**
 * Decodes a GWT custom base-64 encoded integer.
 *
 * This is the inverse of {@link encodeGwtInt}. It reads each character from
 * the string and accumulates the value using base-64 positional notation with
 * the GWT charset (A-Z = 0-25, a-z = 26-51, 0-9 = 52-61, $ = 62, _ = 63).
 *
 * Used to decode article IDs that appear as GWT-encoded strings in the flat
 * array of proposeCitables responses.
 *
 * @param encoded - GWT base-64 encoded string (non-empty, valid charset only)
 * @returns Decoded non-negative integer
 * @throws Error if the string is empty or contains characters outside the GWT charset
 */
export declare function decodeGwtInt(encoded: string): number;
/**
 * Builds the GWT-RPC POST body for JadeRemoteService.proposeCitables(query).
 *
 * proposeCitables is the search/autocomplete method used by jade.io's search box.
 * It returns case names, neutral citations, reported citations, article IDs, and
 * page pinpoints in a single response — the only jade.io method that provides
 * full search results without requiring a second metadata call per result.
 *
 * The request template is 100% static except for the query string at string-table
 * position 6 (the 10th pipe-delimited field). Captured verbatim from HAR analysis
 * of jade.io_03-03-2026-10-08-59.har, entry 11 (query "Mabo ").
 *
 * @param query - Search query string (passed verbatim, no GWT encoding)
 * @returns GWT-RPC v7 serialised request body string
 */
export declare function buildProposeCitablesRequest(query: string): string;
/**
 * Builds the GWT-RPC POST body for JadeRemoteService.getInitialContent(articleId).
 *
 * The request body template was captured verbatim from a live authenticated
 * session (Proxyman HAR, 2026-03-02). Only the GWT-encoded article ID changes
 * between requests; the string table and token stream are otherwise fixed.
 *
 * @param articleId - Numeric jade.io article ID
 * @returns GWT-RPC v7 serialised request body string
 */
export declare function buildGetInitialContentRequest(articleId: number): string;
/**
 * Builds the GWT-RPC POST body for JadeRemoteService.getArticleStructuredMetadata(articleId).
 *
 * Returns a schema.org JSON string with the case name and neutral citation.
 * This call takes an int (JNI type 'J') rather than a Jrl object, making
 * it simpler than getInitialContent.
 *
 * @param articleId - Numeric jade.io article ID
 * @returns GWT-RPC v7 serialised request body string
 */
export declare function buildGetMetadataRequest(articleId: number): string;
/**
 * Builds the GWT-RPC POST body for ArticleViewRemoteService.avd2Request(articleId).
 *
 * This is the primary method for loading article content on jade.io. Unlike
 * getInitialContent (which returns empty body when called directly), avd2Request
 * reliably returns the full article HTML including paragraph anchors.
 *
 * Discovered by intercepting SPA navigation within an authenticated jade.io
 * session (2026-03-02). The request template was captured from Jade Browser
 * case listing navigation to article 1182103.
 *
 * @param articleId - Numeric jade.io article ID
 * @returns GWT-RPC v7 serialised request body string
 */
export declare function buildAvd2Request(articleId: number): string;
/**
 * Parses a GWT-RPC response that may use .concat() for array joining.
 *
 * Large GWT responses split the outer array into multiple segments joined
 * with .concat() when the element count exceeds 32768 (GWT array limit):
 *
 *   //OK[seg1...].concat([seg2..., [string_table], 4, 7])
 *
 * This function handles both simple //OK[...] and .concat() formats.
 * GWT string concatenation ("+") within segments is also handled.
 *
 * @returns flatArray (all elements before the trailing [string_table, typeCount, magic])
 *          and stringTable (the nested array third-from-last in the combined result)
 */
export declare function parseGwtConcatResponse(responseText: string): {
    flatArray: unknown[];
    stringTable: string[];
};
/**
 * Parses an avd2Request GWT-RPC response and extracts the article HTML.
 *
 * The avd2Request response is a complex GWT-RPC serialised object. The format
 * after stripping the //OK prefix is a JavaScript array (not strict JSON - it
 * uses "+" string concatenation for long strings):
 *
 *   [integer_refs..., [string_table_entries...], 4, 7]
 *
 * The HTML content is the longest string in the string table. Unicode escape
 * sequences (\u003C etc.) are decoded by JSON.parse automatically.
 *
 * @param responseText - Raw GWT-RPC response string from avd2Request
 * @returns Decoded HTML content string
 * @throws Error if the response is an exception, malformed, or contains no HTML
 */
export declare function parseAvd2Response(responseText: string): string;
/**
 * Parses a GWT-RPC response envelope and extracts the string payload.
 *
 * jade.io responses for both getInitialContent and getArticleStructuredMetadata
 * follow this structure:
 *   //OK[<type_token>, [], ["<payload_string>"], <flags>, <version>]
 *
 * The payload string (parsed[2][0]) is JSON-encoded; Unicode escape sequences
 * (\uXXXX) are decoded automatically by JSON.parse.
 *
 * @param responseText - Raw GWT-RPC response string
 * @returns Decoded payload string (HTML or JSON depending on the method called)
 * @throws Error if the response is a GWT exception (//EX), malformed, or has no content
 */
export declare function parseGwtRpcResponse(responseText: string): string;
/**
 * Checks whether a value is a plausible GWT-encoded integer string.
 * Valid GWT-encoded ints are 2-7 character strings using only the GWT base-64 charset.
 */
export declare function isGwtEncodedInt(v: unknown): v is string;
/** A case that cites the target case, extracted from a citator response */
export interface CitingCase {
    /** Case name (e.g., "Stuart v South Australia") */
    caseName: string;
    /** Neutral citation (e.g., "[2025] HCA 12") */
    neutralCitation: string;
    /** Reported citation if available */
    reportedCitation?: string;
    /** jade.io article ID if extractable from response */
    articleId?: number;
    /** jade.io article URL (direct or search fallback) */
    jadeUrl: string;
    /** Court name if extractable */
    court?: string;
}
/**
 * Parses a LeftoverRemoteService.search GWT-RPC response and extracts citing cases.
 *
 * ## Parsing Strategy
 *
 * The response uses parseGwtConcatResponse (segmented array format). The string
 * table contains per-case data blocks with neutral citations, case names, article
 * source URLs, and more. This function:
 *
 * 1. Scans the string table for non-zero-padded neutral citations
 * 2. For each, searches forward (then backward) for a case name containing " v " or " & "
 * 3. Extracts article IDs from nearby "jade.io/article/src/{id}/" URLs
 * 4. Extracts the total result count from the flat array
 *
 * @param responseText - Raw GWT-RPC response (may use .concat() format)
 * @returns { results, totalCount }
 */
export declare function parseCitatorResponse(responseText: string): {
    results: CitingCase[];
    totalCount: number;
};
/**
 * A single search result extracted from a proposeCitables GWT-RPC response.
 */
export interface ProposeCitablesResult {
    caseName: string;
    neutralCitation: string;
    reportedCitation?: string;
    articleId?: number;
    jadeUrl: string;
}
/**
 * Parses a proposeCitables GWT-RPC response and extracts structured search results.
 *
 * ## Parsing Strategy
 *
 * The response contains a flat integer array, a type table, and a string table. Rather
 * than fully deserialising the GWT object graph, this function uses the "document in
 * Jade" descriptor strings as anchors:
 *
 * - Descriptors have the form `"[YYYY] COURT NUM; REPORTER VOL PAGE - document in Jade"`
 *   (with reported citation) or `"[YYYY] COURT NUM - document in Jade"` (neutral only).
 * - For descriptors with ";": a GWT-encoded integer may be at flat_pos - 3 (stored
 *   as `articleId` when found, but this is an entity/citable ID, NOT the jade.io URL ID).
 * - For descriptors without ";": a GWT-encoded integer may be at flat_pos + 4.
 * - True jade.io article IDs are extracted separately from the bridge section
 *   (see `extractBridgeCandidates`) and resolved via `resolveBridgeCandidates`.
 * - The `jadeUrl` uses a citation-based search URL as a fallback.
 * - Case names are found by scanning backward in the string table from the descriptor
 *   position (up to 100 entries), looking for the first string containing " v ".
 *
 * Transcript entries (HCATrans) are skipped. Results are deduplicated by neutral citation.
 *
 * @param responseText - Raw GWT-RPC response string from proposeCitables
 * @returns Object with `results` array and the raw `flatArray` for bridge section extraction
 * @throws Error if the response is a GWT exception (//EX) or has an unexpected prefix
 */
export declare function parseProposeCitablesResponse(responseText: string): {
    results: ProposeCitablesResult[];
    flatArray: unknown[];
};
/**
 * A candidate article ID extracted from the bridge section of a proposeCitables
 * GWT-RPC response flat array.
 */
export interface BridgeCandidate {
    /** Position in the flat array where this candidate was found */
    flatPos: number;
    /** Decoded article ID (100-2,000,000 range) */
    articleId: number;
    /** Original GWT-encoded string from the flat array */
    gwtEncoded: string;
    /**
     * Confidence level:
     * - `high`: preceded by another GWT string whose decoded value is larger
     *   (the [record ID] [article ID] structural pattern)
     * - `medium`: GWT string in range but no preceding record ID
     */
    confidence: "high" | "medium";
}
/**
 * Extracts candidate article IDs from the bridge section of a proposeCitables
 * flat array.
 *
 * ## Background
 *
 * The proposeCitables response contains a flat array where the last ~10% (the
 * "bridge section") holds lookup-table entries mapping internal record IDs to
 * jade.io article IDs. The structural pattern is:
 *
 *   flat[i-1] = GWT-encoded record ID (larger value, e.g. 20422242)
 *   flat[i]   = GWT-encoded article ID (smaller value, e.g. 776897)
 *
 * Candidates are filtered to 2-5 character GWT strings decoding to 100-2,000,000
 * (plausible jade.io article ID range). Candidates preceded by a larger GWT value
 * are scored as high confidence.
 *
 * @param flatArray - The flat array portion of a parsed proposeCitables response
 * @returns Up to 30 candidates, high-confidence first, then medium, each sorted by position
 */
export declare function extractBridgeCandidates(flatArray: unknown[]): BridgeCandidate[];
/**
 * Builds a GWT-RPC request body for LeftoverRemoteService.search.
 *
 * This performs a citation search ("who cites this case?") on jade.io.
 * The input is a citable ID (NOT an article ID), obtained from a
 * proposeCitables response via extractCitableIds().
 *
 * The request template was captured verbatim from jade.io's citator UI
 * (2026-03-03 HAR, entry 6). The citable ID is parameterised; all other
 * fields are static. String table has 35 entries; the citable ID is at
 * string table position 12 (field "JZd2" in the serialised data section).
 *
 * Criteria encoded in the template:
 * - Sort: effective date descending
 * - IgnoreSelfCitations: true
 * - IgnoreShortCitations: true (repeated citations in short sections)
 *
 * @param citableId - The numeric citable ID for the target case
 * @returns GWT-RPC request body string
 */
export declare function buildCitatorSearchRequest(citableId: number): string;
export interface ExtractedCitableId {
    /** Position in the flat array */
    flatPos: number;
    /** Decoded citable ID (2M-10M range) */
    citableId: number;
    /** Original GWT-encoded string */
    gwtEncoded: string;
}
/**
 * Extracts citable IDs from the data section of a proposeCitables flat array.
 *
 * Citable IDs are GWT-encoded integers in the 2M-10M range, distinct from:
 * - Article IDs (100-2M): used in jade.io/article/{id} URLs
 * - Record IDs (10M+): internal bridge section lookups
 *
 * Citable IDs appear in the first 30% of the flat array (the "citable objects"
 * section), not in the bridge section (last 10%). They are required as input
 * to LeftoverRemoteService.search (citator).
 *
 * Ground truth: Mabo [1992] HCA 23 → citable ID 2463606 (GWT: "JZd2"),
 * confirmed across 4 independent HAR captures at flat[3724] in proposeCitables.
 */
export declare function extractCitableIds(flatArray: unknown[]): ExtractedCitableId[];
//# sourceMappingURL=jade-gwt.d.ts.map