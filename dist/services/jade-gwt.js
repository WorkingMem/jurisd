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
/**
 * GWT's custom base-64 charset.
 * Index 0 = 'A', 25 = 'Z', 26 = 'a', 51 = 'z', 52 = '0', 61 = '9', 62 = '$', 63 = '_'
 */
const GWT_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$_";
/** jade.io GWT module base URL — part of the serialisation header */
export const JADE_MODULE_BASE = "https://jade.io/au.com.barnet.jade.JadeClient/";
/**
 * GWT-RPC strong name (type hash) for JadeRemoteService.
 * This may change when jade.io redeploys the GWT app.
 * If content fetching returns an exception response, this hash may need refreshing
 * by inspecting the X-GWT-Permutation header in a fresh browser session.
 * Last verified: 2026-06-13.
 */
export const JADE_STRONG_NAME = "F6E610452C7A15DE693DC8F95CF6849C";
/**
 * GWT-RPC strong name (type hash) for ArticleViewRemoteService.
 * This service handles article content loading via the avd2Request method.
 * Discovered via SPA navigation interception (2026-03-02). Last verified: 2026-06-13.
 */
export const AVD2_STRONG_NAME = "140B3EF36354F0C5A95299A70B18A25F";
/**
 * GWT permutation identifier for the Chrome/macOS compiled JS bundle.
 * Sent in the X-GWT-Permutation request header.
 * Different from JADE_STRONG_NAME - this identifies the browser-specific
 * JavaScript permutation, not the serialisation type hash.
 * Last verified: 2026-06-13.
 */
export const JADE_PERMUTATION = "9F7FA3DEE1E002939D47FA3D6C3F3DA1";
/**
 * GWT-RPC strong name (type hash) for LeftoverRemoteService.
 * This service handles citation-context searches ("who cites this article")
 * and citation data retrieval. NOT used for freetext case search.
 * Discovered from HAR analysis (2026-03-03). Last verified: 2026-06-13.
 */
export const LEFTOVER_STRONG_NAME = "C759183224A415CB53405469AC1B351C";
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
export function encodeGwtInt(n) {
    if (!Number.isInteger(n) || n < 0) {
        throw new Error(`GWT int encoding: non-negative integer required, got: ${n}`);
    }
    if (n === 0)
        return "A";
    let result = "";
    let remaining = n;
    while (remaining > 0) {
        result = GWT_CHARSET[remaining & 63] + result;
        remaining = Math.floor(remaining / 64);
    }
    return result;
}
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
export function decodeGwtInt(encoded) {
    if (!encoded) {
        throw new Error("GWT int decoding: non-empty string required");
    }
    let result = 0;
    for (const char of encoded) {
        const index = GWT_CHARSET.indexOf(char);
        if (index === -1) {
            throw new Error(`GWT int decoding: character '${char}' is not in GWT charset`);
        }
        result = result * 64 + index;
    }
    return result;
}
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
export function buildProposeCitablesRequest(query) {
    return (`7|0|10|${JADE_MODULE_BASE}|${JADE_STRONG_NAME}|` +
        `au.com.barnet.jade.cs.remote.JadeRemoteService|proposeCitables|` +
        `java.lang.String/2004016611|` +
        `au.com.barnet.jade.cs.csobjects.qsearch.QuickSearchFlags/2740681188|` +
        `${query}|` +
        `au.com.barnet.jade.cs.csobjects.qsearchdesktop.QuickSearchFlagsDesktop/2291862948|` +
        `java.util.HashSet/3273092938|` +
        `au.com.barnet.jade.cs.persistent.shared.CitableType/1576180844|` +
        `1|2|3|4|2|5|6|7|8|1|1|1|0|0|1|0|9|4|10|0|10|1|10|2|10|3|1|0|0|1|0|9|0|0|0|0|0|1|1|1|`);
}
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
export function buildGetInitialContentRequest(articleId) {
    const encodedId = encodeGwtInt(articleId);
    return (`7|0|7|${JADE_MODULE_BASE}|${JADE_STRONG_NAME}|` +
        `au.com.barnet.jade.cs.remote.JadeRemoteService|` +
        `getInitialContent|` +
        `au.com.barnet.jade.cs.persistent.Jrl/728826604|` +
        `au.com.barnet.jade.cs.persistent.Article|` +
        `java.util.ArrayList/4159755760|` +
        `1|2|3|4|1|5|5|${encodedId}|A|0|A|A|6|0|`);
}
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
export function buildGetMetadataRequest(articleId) {
    const encodedId = encodeGwtInt(articleId);
    return (`7|0|5|${JADE_MODULE_BASE}|${JADE_STRONG_NAME}|` +
        `au.com.barnet.jade.cs.remote.JadeRemoteService|` +
        `getArticleStructuredMetadata|J|` +
        `1|2|3|4|1|5|${encodedId}|`);
}
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
export function buildAvd2Request(articleId) {
    const encodedId = encodeGwtInt(articleId);
    return (`7|0|10|${JADE_MODULE_BASE}|${AVD2_STRONG_NAME}|` +
        `au.com.barnet.jade.cs.remote.ArticleViewRemoteService|avd2Request|` +
        `au.com.barnet.jade.cs.csobjects.avd.Avd2Request/2858816011|` +
        `au.com.barnet.jade.cs.persistent.Jrl/728826604|` +
        `au.com.barnet.jade.cs.persistent.Article|` +
        `java.util.ArrayList/4159755760|` +
        `au.com.barnet.jade.cs.csobjects.avd.PhraseFrequencyParams/1915696367|` +
        `cc.alcina.framework.common.client.util.IntPair/1982199244|` +
        `1|2|3|4|1|5|5|A|A|0|6|${encodedId}|A|0|A|A|7|0|0|0|8|0|0|9|0|10|3|500|A|8|0|8|0|`);
}
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
export function parseGwtConcatResponse(responseText) {
    if (responseText.startsWith("//EX")) {
        throw new Error("jade.io GWT-RPC server returned an exception response");
    }
    if (!responseText.startsWith("//OK")) {
        throw new Error(`Unexpected GWT-RPC response format: ${responseText.substring(0, 50)}`);
    }
    const stripped = responseText.slice(4);
    const segments = stripped.split(".concat(");
    const allArrays = [];
    for (let i = 0; i < segments.length; i++) {
        let seg = segments[i];
        // Remove trailing close-parens from .concat() nesting
        if (i > 0) {
            let trailingParens = 0;
            for (let j = seg.length - 1; j >= 0; j--) {
                if (seg[j] === ")")
                    trailingParens++;
                else
                    break;
            }
            seg = seg.substring(0, seg.length - trailingParens);
        }
        // Handle GWT string concatenation ("+" within string values)
        seg = seg.replace(/"\+"/g, "");
        const parsed = JSON.parse(seg);
        if (!Array.isArray(parsed)) {
            throw new Error(`GWT segment ${i} is not an array`);
        }
        allArrays.push(parsed);
    }
    const fullArray = allArrays.reduce((a, b) => a.concat(b), []);
    if (fullArray.length < 4) {
        return { flatArray: [], stringTable: [] };
    }
    const stringTable = fullArray[fullArray.length - 3];
    if (!Array.isArray(stringTable)) {
        return { flatArray: fullArray, stringTable: [] };
    }
    // Flat array is everything before the trailing [stringTable, typeCount, magic]
    const flatArray = fullArray.slice(0, fullArray.length - 3);
    return { flatArray, stringTable: stringTable };
}
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
export function parseAvd2Response(responseText) {
    if (responseText.startsWith("//EX")) {
        throw new Error("jade.io GWT-RPC server returned an exception response");
    }
    if (!responseText.startsWith("//OK")) {
        throw new Error(`Unexpected GWT-RPC response format (expected //OK prefix): ${responseText.substring(0, 50)}`);
    }
    // Strip //OK prefix and join GWT's string concatenation markers
    const stripped = responseText.slice(4);
    const joined = stripped.replace(/"\+"/g, "");
    let parsed;
    try {
        parsed = JSON.parse(joined);
    }
    catch (e) {
        throw new Error(`Failed to parse avd2 GWT-RPC response: ${e}`);
    }
    if (!Array.isArray(parsed) || parsed.length < 3) {
        throw new Error("avd2 GWT-RPC response has unexpected structure");
    }
    // Response format: [...integers..., [string_table], 4, 7]
    // The string table is a nested array at parsed[len-3]
    const stringTable = parsed[parsed.length - 3];
    if (!Array.isArray(stringTable) || stringTable.length === 0) {
        throw new Error("avd2 response: could not locate string table");
    }
    // The HTML content is the longest string in the string table
    let html = "";
    for (const entry of stringTable) {
        if (typeof entry === "string" && entry.length > html.length) {
            html = entry;
        }
    }
    if (!html || !html.includes("<")) {
        throw new Error("No HTML content found in avd2 GWT-RPC response string table");
    }
    return html;
}
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
export function parseGwtRpcResponse(responseText) {
    if (responseText.startsWith("//EX")) {
        throw new Error("jade.io GWT-RPC server returned an exception response");
    }
    if (!responseText.startsWith("//OK")) {
        throw new Error(`Unexpected GWT-RPC response format (expected //OK prefix): ${responseText.substring(0, 50)}`);
    }
    const jsonPart = responseText.substring(4);
    let parsed;
    try {
        parsed = JSON.parse(jsonPart);
    }
    catch (e) {
        throw new Error(`Failed to parse GWT-RPC response body as JSON: ${e}`);
    }
    if (!Array.isArray(parsed) || parsed.length < 3) {
        throw new Error(`GWT-RPC response has unexpected structure (need array of length >= 3)`);
    }
    const stringTable = parsed[2];
    if (!Array.isArray(stringTable) || stringTable.length === 0) {
        throw new Error(`GWT-RPC response has empty string table - article may not have content or may require authentication`);
    }
    const content = stringTable[0];
    if (typeof content !== "string") {
        throw new Error(`GWT-RPC string table first element is not a string: ${typeof content}`);
    }
    return content;
}
/**
 * Checks whether a value is a plausible GWT-encoded integer string.
 * Valid GWT-encoded ints are 2-7 character strings using only the GWT base-64 charset.
 */
export function isGwtEncodedInt(v) {
    if (typeof v !== "string" || v.length < 2 || v.length > 7)
        return false;
    return [...v].every((c) => GWT_CHARSET.includes(c));
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
export function parseCitatorResponse(responseText) {
    const { flatArray, stringTable } = parseGwtConcatResponse(responseText);
    if (flatArray.length === 0 || stringTable.length === 0) {
        return { results: [], totalCount: 0 };
    }
    // Step 1: Build citation -> articleId map from "jade.io/article/src/{id}/" URLs
    // Each src URL appears within a few positions of its neutral citation in the string table
    const citToArticleId = new Map();
    for (let i = 0; i < stringTable.length; i++) {
        const s = stringTable[i];
        if (typeof s !== "string")
            continue;
        const urlMatch = s.match(/\/article\/src\/(\d+)\//);
        if (!urlMatch)
            continue;
        const artId = parseInt(urlMatch[1], 10);
        // Search nearby string table entries for a neutral citation
        for (let j = Math.max(0, i - 30); j <= Math.min(stringTable.length - 1, i + 30); j++) {
            if (j === i)
                continue;
            const nearby = stringTable[j];
            if (typeof nearby === "string" &&
                /^\[\d{4}\]\s+[A-Z]/.test(nearby) &&
                nearby.length < 40 &&
                !/\s+0\d/.test(nearby) &&
                !nearby.includes("/")) {
                if (!citToArticleId.has(nearby)) {
                    citToArticleId.set(nearby, artId);
                }
            }
        }
    }
    // Step 2: Extract unique neutral citations and match case names
    const seen = new Set();
    const results = [];
    for (let i = 0; i < stringTable.length; i++) {
        const s = stringTable[i];
        if (typeof s !== "string")
            continue;
        // Must be a non-zero-padded neutral citation in short form
        if (!/^\[\d{4}\]\s+[A-Z]/.test(s) || s.length >= 40)
            continue;
        if (/\s+0\d/.test(s))
            continue; // skip zero-padded form
        if (s.includes("/") || s.includes("$"))
            continue; // skip type descriptors
        const normCit = s.trim();
        if (seen.has(normCit))
            continue;
        // Find case name: scan forward first (idx+1..idx+10), then backward
        let caseName;
        for (let j = i + 1; j <= Math.min(stringTable.length - 1, i + 10); j++) {
            const candidate = stringTable[j];
            if (typeof candidate !== "string")
                continue;
            // Stop if we hit another citation or GWT type descriptor
            if (/^\[\d{4}\]/.test(candidate) && !candidate.includes(normCit))
                break;
            if (candidate.includes("au.com.barnet") || candidate.includes("java.util"))
                break;
            // Prefer entries that contain " v " or " & " and are short enough to be a case name
            const hasCaseMarker = candidate.includes(" v ") || candidate.includes(" & ");
            if (!hasCaseMarker)
                continue;
            // Strip trailing citation if present (e.g., "Name v Party [YYYY] COURT N ...")
            const bracketIdx = candidate.indexOf("[");
            const rawName = bracketIdx > 0 ? candidate.substring(0, bracketIdx).trim() : candidate;
            if (rawName.length > 5 && rawName.length < 120) {
                caseName = rawName;
                break;
            }
        }
        if (!caseName) {
            // Backward scan fallback
            for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
                const candidate = stringTable[j];
                if (typeof candidate !== "string")
                    continue;
                if (/^\[\d{4}\]/.test(candidate) || candidate.includes("au.com.barnet"))
                    break;
                const hasCaseMarker = candidate.includes(" v ") || candidate.includes(" & ");
                if (!hasCaseMarker || candidate.startsWith("file:"))
                    continue;
                const bracketIdx = candidate.indexOf("[");
                const rawName = bracketIdx > 0 ? candidate.substring(0, bracketIdx).trim() : candidate;
                if (rawName.length > 5 && rawName.length < 120) {
                    caseName = rawName;
                    break;
                }
            }
        }
        if (!caseName)
            continue;
        seen.add(normCit);
        const articleId = citToArticleId.get(normCit);
        const jadeUrl = articleId
            ? `https://jade.io/article/${articleId}`
            : `https://jade.io/search/${encodeURIComponent(normCit)}`;
        results.push({ caseName, neutralCitation: normCit, articleId, jadeUrl });
    }
    // Step 3: Extract total count from flat array
    // In the CitableSearchResults GWT structure, totalCount is a positive integer
    // preceded by the integer 5 (GWT type index for Article) and followed by a
    // large negative string-table reference (< -1000). This pattern reliably
    // identifies the totalCount field.
    let totalCount = results.length;
    const scanFrom = Math.max(0, flatArray.length - 2500);
    for (let i = scanFrom + 1; i < flatArray.length - 1; i++) {
        const v = flatArray[i];
        if (typeof v !== "number" || v <= results.length || v > 100_000)
            continue;
        const prev = flatArray[i - 1];
        const next = flatArray[i + 1];
        if (prev === 5 && typeof next === "number" && next < -1000) {
            totalCount = v;
            break;
        }
    }
    return { results, totalCount };
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
export function parseProposeCitablesResponse(responseText) {
    if (responseText.startsWith("//EX")) {
        throw new Error("jade.io GWT-RPC server returned an exception response");
    }
    if (!responseText.startsWith("//OK")) {
        throw new Error(`Unexpected GWT-RPC response format (expected //OK prefix): ${responseText.substring(0, 50)}`);
    }
    const stripped = responseText.slice(4);
    const joined = stripped.replace(/"\+""/g, "");
    const empty = { results: [], flatArray: [] };
    let parsed;
    try {
        parsed = JSON.parse(joined);
    }
    catch {
        return empty;
    }
    if (!Array.isArray(parsed) || parsed.length < 4) {
        return empty;
    }
    const stringTable = parsed[parsed.length - 3];
    if (!Array.isArray(stringTable) || stringTable.length === 0) {
        return empty;
    }
    // Everything before the last 4 elements is the flat integer/string array
    const flatArray = parsed.slice(0, parsed.length - 4);
    // Helper: check whether a value is a GWT-encoded integer string
    function isGwtEncoded(v) {
        return isGwtEncodedInt(v);
    }
    // Build a lookup: string-table index → flat-array positions that reference it
    const refToFlatPositions = new Map();
    for (let pos = 0; pos < flatArray.length; pos++) {
        const v = flatArray[pos];
        if (typeof v === "number" && v < 0) {
            const idx = Math.abs(v) - 1;
            const arr = refToFlatPositions.get(idx);
            if (arr) {
                arr.push(pos);
            }
            else {
                refToFlatPositions.set(idx, [pos]);
            }
        }
    }
    const results = [];
    const seenCitations = new Set();
    for (let descIdx = 0; descIdx < stringTable.length; descIdx++) {
        const descriptor = stringTable[descIdx];
        if (typeof descriptor !== "string" || !descriptor.endsWith("- document in Jade")) {
            continue;
        }
        // Skip hearing transcripts — they are not primary judgments
        if (descriptor.includes("HCATrans"))
            continue;
        const descriptorContent = descriptor.slice(0, -" - document in Jade".length).trim();
        const hasSemicolon = descriptorContent.includes(";");
        let neutralCitation;
        let reportedCitation;
        if (hasSemicolon) {
            const semiIdx = descriptorContent.indexOf(";");
            neutralCitation = descriptorContent.slice(0, semiIdx).trim();
            reportedCitation = descriptorContent.slice(semiIdx + 1).trim();
        }
        else {
            neutralCitation = descriptorContent;
        }
        // Scan backward in the string table for the case name (string containing " v ")
        const scanStart = hasSemicolon ? descIdx - 2 : descIdx - 1;
        let caseName;
        for (let i = scanStart; i >= Math.max(0, descIdx - 100); i--) {
            const s = stringTable[i];
            if (typeof s === "string" && s.includes(" v ") && s.length > 5) {
                caseName = s;
                break;
            }
        }
        // Fallback for non-";" entries: use the string immediately before the descriptor
        if (!caseName && !hasSemicolon) {
            const candidate = stringTable[descIdx - 1];
            if (typeof candidate === "string" &&
                candidate.length > 3 &&
                !candidate.startsWith("[") &&
                !candidate.endsWith("- document in Jade") &&
                !candidate.includes("au.com.barnet")) {
                caseName = candidate;
            }
        }
        if (!caseName)
            continue;
        // Find the article ID in the flat array
        const flatPositions = refToFlatPositions.get(descIdx) ?? [];
        let articleId;
        for (const flatPos of flatPositions) {
            const gwtCandidate = hasSemicolon ? flatArray[flatPos - 3] : flatArray[flatPos + 4];
            if (isGwtEncoded(gwtCandidate)) {
                articleId = decodeGwtInt(gwtCandidate);
                break;
            }
        }
        if (seenCitations.has(neutralCitation))
            continue;
        seenCitations.add(neutralCitation);
        results.push({
            caseName,
            neutralCitation,
            reportedCitation,
            articleId,
            jadeUrl: `https://jade.io/search/${encodeURIComponent(neutralCitation)}`,
        });
    }
    return { results, flatArray };
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
export function extractBridgeCandidates(flatArray) {
    const bridgeStart = Math.floor(flatArray.length * 0.9);
    const high = [];
    const medium = [];
    for (let i = bridgeStart; i < flatArray.length; i++) {
        const val = flatArray[i];
        if (typeof val !== "string" || val.length < 2 || val.length > 5)
            continue;
        if (!isGwtEncodedInt(val))
            continue;
        const decoded = decodeGwtInt(val);
        if (decoded < 100 || decoded > 2_000_000)
            continue;
        // Check for the [record ID] [article ID] structural pattern
        const prev = flatArray[i - 1];
        if (isGwtEncodedInt(prev) && decodeGwtInt(prev) > decoded) {
            high.push({ flatPos: i, articleId: decoded, gwtEncoded: val, confidence: "high" });
        }
        else {
            medium.push({ flatPos: i, articleId: decoded, gwtEncoded: val, confidence: "medium" });
        }
    }
    return [...high, ...medium].slice(0, 30);
}
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
export function buildCitatorSearchRequest(citableId) {
    const gwtId = encodeGwtInt(citableId);
    return (`7|0|35|${JADE_MODULE_BASE}|${LEFTOVER_STRONG_NAME}|` +
        `au.com.barnet.jade.cs.remote.LeftoverRemoteService|search|` +
        `cc.alcina.framework.common.client.search.SearchDefinition/58859665|` +
        `au.com.barnet.jade.cs.trans.othersearch.citation.CitationSearchDefinition/955429335|` +
        `au.com.barnet.jade.cs.trans.othersearch.citable.CitableSearchDefinition$CitableSearchDefinitionResultType/866007608|` +
        `cc.alcina.framework.common.client.logic.domaintransform.lookup.LightSet/1335044906|` +
        `au.com.barnet.jade.cs.trans.othersearch.citation.CitableAndSectionsCriteriaGroup/1688548685|` +
        `cc.alcina.framework.common.client.logic.FilterCombinator/3213752301|` +
        `au.com.barnet.jade.cs.trans.othersearch.citation.CitableAndSectionsCriterion/4126754736|` +
        `au.com.barnet.jade.cs.trans.othersearch.citation.CitableCriterion/1545253367|` +
        `cc.alcina.framework.gwt.client.objecttree.search.StandardSearchOperator/2244035871|` +
        `java.util.ArrayList/4159755760|` +
        `au.com.barnet.jade.cs.trans.searchcriteria.JTextCriteriaGroup/1895870655|` +
        `text (in the citing case)|` +
        `au.com.barnet.jade.cs.trans.othersearch.citation.CitationsFilterCriteriaGroup/3683112863|` +
        `java.util.LinkedHashSet/95640124|` +
        `au.com.barnet.jade.cs.trans.othersearch.citation.IgnoreSelfCitationsCriterion/3894086720|` +
        `cc.alcina.framework.common.client.search.BooleanEnum/357020803|` +
        ` ignore self citations|` +
        `au.com.barnet.jade.cs.trans.othersearch.citation.IgnoreShortCitationsCriterion/2514397111|` +
        ` ignore repeated citations in short sections|` +
        `au.com.barnet.jade.cs.trans.othersearch.citation.CitationSourceFilterTypeEnumCriterion/4253248484|` +
        `au.com.barnet.jade.cs.csobjects.citables.CitationSourceFilterType/2049537451|` +
        `|` +
        `au.com.barnet.jade.cs.trans.searchcriteria.JournalCriteriaGroup/3343901624|` +
        `au.com.barnet.jade.cs.trans.othersearch.citation.CitationSourceCriteriaGroup/2323780731|` +
        `au.com.barnet.jade.cs.trans.searchcriteria.EffectiveDateCriteriaGroup/2950889875|` +
        `au.com.barnet.jade.cs.trans.searchcriteria.RetrievalDateCriteriaGroup/4014795601|` +
        `au.com.barnet.jade.cs.trans.searchcriteria.FirstExternalEnabledDateCriteriaGroup/311159311|` +
        `au.com.barnet.jade.cs.trans.othersearch.citation.CitationSearchDefinition$CitationOrderGroup1/1895249254|` +
        `au.com.barnet.jade.cs.trans.searchcriteria.order.JadeOrderCriterion$EffectiveDateDescendingOrder/1968635164|` +
        `cc.alcina.framework.common.client.search.SearchCriterion$Direction/3994719561|` +
        `au.com.barnet.jade.cs.trans.othersearch.citation.CitationSearchDefinition$CitationOrderGroup2/3936337759|` +
        `1|2|3|4|1|5|6|7|3|0|0|1|8|8|9|10|1|8|1|11|12|0|0|${gwtId}|0|13|2|14|0|0|0|15|16|10|0|8|0|` +
        `17|-12|18|3|19|20|1|1|21|-9|22|-17|1|23|-9|24|25|0|0|26|-9|27|-5|8|0|28|-5|8|0|` +
        `29|-12|8|0|30|-12|8|0|31|-12|8|0|0|8|2|32|-12|18|1|33|34|1|0|0|35|-12|8|0|0|0|0|25|`);
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
export function extractCitableIds(flatArray) {
    const results = [];
    // Scan only the first 30% (citable objects section, not the bridge section)
    const scanEnd = Math.floor(flatArray.length * 0.3);
    for (let i = 0; i < scanEnd; i++) {
        const v = flatArray[i];
        if (typeof v !== "string" || v.length < 3 || v.length > 5)
            continue;
        if (!isGwtEncodedInt(v))
            continue;
        const decoded = decodeGwtInt(v);
        if (decoded >= 2_000_000 && decoded <= 10_000_000) {
            results.push({ flatPos: i, citableId: decoded, gwtEncoded: v });
        }
    }
    return results;
}
//# sourceMappingURL=jade-gwt.js.map