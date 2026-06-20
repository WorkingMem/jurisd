import axios from "axios";
import type { SearchResult, SearchOptions } from "./austlii.js";
import { config } from "../config.js";
import { jadeRateLimiter } from "../utils/rate-limiter.js";
import { assertRedirectAllowed, MAX_REDIRECTS } from "../utils/url-guard.js";
import {
  buildAvd2Request,
  parseAvd2Response,
  buildProposeCitablesRequest,
  parseProposeCitablesResponse,
  extractBridgeCandidates,
  extractCitableIds,
  buildCitatorSearchRequest,
  parseCitatorResponse,
  type CitingCase,
  JADE_MODULE_BASE,
  JADE_PERMUTATION,
} from "./jade-gwt.js";

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

// ── Types ──────────────────────────────────────────────────────────────

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

export interface JadeSearchOutcome {
  results: SearchResult[];
  status: "ok" | "not_configured" | "failed";
}

// ── Constants ──────────────────────────────────────────────────────────

const JADE_SEARCH_URL = `${config.jade.baseUrl}/search`;

/** jade.io's generic/fallback title when an article isn't publicly accessible */
const JADE_GENERIC_TITLE = "BarNet Jade - Find recent Australian legal decisions";

/** Neutral citation pattern: [YYYY] COURT NUM */
const NEUTRAL_CITATION_RE = /\[(\d{4})\]\s+([A-Z]+(?:\s+[A-Z]+)?)\s+(\d+)/;

/** Map court abbreviations to jurisdiction codes */
const COURT_TO_JURISDICTION: Record<string, string> = {
  HCA: "cth",
  FCAFC: "cth",
  FCA: "cth",
  AATA: "cth",
  NSWSC: "nsw",
  NSWCA: "nsw",
  NSWCCA: "nsw",
  NSWDC: "nsw",
  NSWLEC: "nsw",
  VSC: "vic",
  VSCA: "vic",
  VCC: "vic",
  QSC: "qld",
  QCA: "qld",
  QDC: "qld",
  SASC: "sa",
  SASCFC: "sa",
  SADC: "sa",
  WASC: "wa",
  WASCA: "wa",
  WADC: "wa",
  TASSC: "tas",
  TASFC: "tas",
  NTSC: "nt",
  NTCA: "nt",
  ACTSC: "act",
  ACTCA: "act",
  NZHC: "nz",
  NZCA: "nz",
  NZSC: "nz",
};

// ── URL Utilities ──────────────────────────────────────────────────────

/**
 * Checks whether a URL belongs to jade.io
 */
export function isJadeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "jade.io" || parsed.hostname.endsWith(".jade.io");
  } catch {
    return false;
  }
}

/**
 * Extracts article ID from a jade.io URL
 * Supports patterns:
 *   - https://jade.io/article/12345
 *   - https://jade.io/j/?a=outline&id=12345
 *   - https://jade.io/article/12345/some/path
 */
export function extractArticleId(url: string): number | undefined {
  // Pattern 1: /article/{id}
  const articleMatch = url.match(/\/article\/(\d+)/);
  if (articleMatch?.[1]) {
    return parseInt(articleMatch[1], 10);
  }

  // Pattern 2: ?id={id} or &id={id}
  try {
    const parsed = new URL(url);
    const idParam = parsed.searchParams.get("id");
    if (idParam && /^\d+$/.test(idParam)) {
      return parseInt(idParam, 10);
    }
  } catch {
    // Invalid URL, fall through
  }

  return undefined;
}

/**
 * Constructs the canonical jade.io article URL for a given article ID
 */
export function buildArticleUrl(articleId: number): string {
  return `${config.jade.baseUrl}/article/${articleId}`;
}

/**
 * Constructs a jade.io search URL for a given query.
 * Note: This URL opens jade.io's SPA with the search pre-filled.
 * It does NOT return machine-readable results.
 */
export function buildSearchUrl(query: string): string {
  return `${JADE_SEARCH_URL}/${encodeURIComponent(query)}`;
}

// ── Citation Parsing ───────────────────────────────────────────────────

/**
 * Extracts neutral citation from a jade.io page title.
 * jade.io titles follow the pattern: "Case Name [YYYY] COURT NUM - BarNet Jade"
 */
export function parseTitleMetadata(rawTitle: string): {
  title: string;
  neutralCitation?: string;
  jurisdiction?: string;
  year?: string;
} {
  // Strip " - BarNet Jade" suffix
  const title = rawTitle.replace(/\s*-\s*BarNet Jade\s*$/i, "").trim();

  // Try to extract neutral citation
  const citationMatch = title.match(NEUTRAL_CITATION_RE);
  if (citationMatch) {
    const neutralCitation = citationMatch[0];
    const year = citationMatch[1];
    const court = citationMatch[2]?.replace(/\s+/g, "");
    const jurisdiction = court ? COURT_TO_JURISDICTION[court] : undefined;

    return { title, neutralCitation, jurisdiction, year };
  }

  return { title };
}

/**
 * Extracts jurisdiction from a court abbreviation
 */
export function getJurisdictionFromCourt(court: string): string | undefined {
  const normalized = court.replace(/\s+/g, "").toUpperCase();
  return COURT_TO_JURISDICTION[normalized];
}

// ── Article Resolution ─────────────────────────────────────────────────

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
export async function resolveArticle(articleId: number): Promise<JadeArticle> {
  const url = buildArticleUrl(articleId);

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": config.jade.userAgent,
        Accept: "text/html",
      },
      timeout: config.jade.timeout,
      // jade.io pages can be substantial when authenticated
      maxContentLength: 5 * 1024 * 1024,
      maxRedirects: MAX_REDIRECTS,
      beforeRedirect: assertRedirectAllowed,
    });

    const html: string = typeof response.data === "string" ? response.data : String(response.data);

    // Extract <title> tag content
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const rawTitle = titleMatch?.[1]?.replace(/\s+/g, " ").trim();

    if (!rawTitle || rawTitle.startsWith(JADE_GENERIC_TITLE)) {
      // Article not publicly accessible or doesn't exist
      return {
        id: articleId,
        title: "",
        url,
        accessible: false,
      };
    }

    const parsed = parseTitleMetadata(rawTitle);

    return {
      id: articleId,
      title: parsed.title,
      neutralCitation: parsed.neutralCitation,
      jurisdiction: parsed.jurisdiction,
      year: parsed.year,
      url,
      accessible: true,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      return {
        id: articleId,
        title: "",
        url,
        accessible: false,
      };
    }
    throw error;
  }
}

/**
 * Resolves metadata for a jade.io article from its URL.
 * Extracts the article ID from the URL and resolves it.
 */
export async function resolveArticleFromUrl(url: string): Promise<JadeArticle | undefined> {
  const articleId = extractArticleId(url);
  if (articleId === undefined) {
    return undefined;
  }
  return resolveArticle(articleId);
}

// ── Search Result Conversion ───────────────────────────────────────────

/**
 * Converts a resolved jade.io article into a SearchResult.
 * Used when cross-referencing AustLII results with jade.io.
 */
export function articleToSearchResult(
  article: JadeArticle,
  type: "case" | "legislation",
): SearchResult {
  return {
    title: article.title,
    neutralCitation: article.neutralCitation,
    url: article.url,
    source: "jade",
    jurisdiction: article.jurisdiction,
    year: article.year,
    type,
  };
}

/**
 * Attempts to find a jade.io article for a given neutral citation.
 * Since jade.io has no search API, this constructs a search URL
 * that the user can open, and returns metadata about the lookup.
 *
 * @param citation - Neutral citation string, e.g. "[2008] NSWSC 323"
 * @returns Search URL the user can use to find the article on jade.io
 */
export function buildCitationLookupUrl(citation: string): string {
  return buildSearchUrl(citation);
}

// ── AustLII Cross-Reference ────────────────────────────────────────────

/**
 * Enriches AustLII search results with jade.io links where possible.
 * For each result with a neutral citation, constructs a jade.io search URL.
 *
 * @param results - AustLII search results
 * @returns Results with jadeUrl added where applicable
 */
export function enrichWithJadeLinks(
  results: SearchResult[],
): Array<SearchResult & { jadeUrl?: string }> {
  return results.map((result) => {
    if (result.neutralCitation) {
      return {
        ...result,
        jadeUrl: buildCitationLookupUrl(result.neutralCitation),
      };
    }
    return result;
  });
}

// ── Bridge Section Article ID Resolution ────────────────────────────────

/**
 * Normalise a neutral citation for comparison: trim whitespace, collapse
 * internal runs of whitespace to single spaces.
 */
function normaliseCitation(citation: string): string {
  return citation.trim().replace(/\s+/g, " ");
}

/**
 * Resolves bridge section candidates against jade.io to build a
 * neutral-citation-to-article-ID map. Candidates are validated by fetching
 * the article page (public GET) and checking the title for a neutral citation.
 *
 * Returns a Map of normalised neutral citation to confirmed article ID.
 */
async function resolveBridgeCandidates(flatArray: unknown[]): Promise<Map<string, number>> {
  const candidates = extractBridgeCandidates(flatArray);
  if (candidates.length === 0) return new Map();

  // Resolve high-confidence candidates first
  const settled = await Promise.allSettled(candidates.map((c) => resolveArticle(c.articleId)));

  const citationToId = new Map<string, number>();
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]!;
    if (result.status !== "fulfilled") continue;
    const article = result.value;
    if (!article.accessible || !article.neutralCitation) continue;
    const key = normaliseCitation(article.neutralCitation);
    if (!citationToId.has(key)) {
      citationToId.set(key, article.id);
    }
  }

  return citationToId;
}

/**
 * Searches jade.io using the proposeCitables GWT-RPC method.
 *
 * proposeCitables is jade.io's internal search/autocomplete endpoint, reverse-engineered
 * from HAR analysis (2026-03-03). It returns case names, neutral citations, reported
 * citations, and jade.io article IDs in a single response.
 *
 * Requires JADE_SESSION_COOKIE.
 *
 * @param query - Search query string
 * @param options - Search options (type, jurisdiction, limit, etc.)
 * @returns Array of SearchResult objects
 */
async function searchJadeStrict(query: string, options: SearchOptions): Promise<SearchResult[]> {
  await jadeRateLimiter.throttle();

  const requestBody = buildProposeCitablesRequest(query);
  const url = `${config.jade.baseUrl}/jadeService.do`;

  const response = await axios.post(url, requestBody, {
    headers: {
      "Content-Type": "text/x-gwt-rpc; charset=UTF-8",
      "X-GWT-Module-Base": JADE_MODULE_BASE,
      "X-GWT-Permutation": JADE_PERMUTATION,
      Origin: "https://jade.io",
      Referer: "https://jade.io/",
      "User-Agent": config.jade.userAgent,
      Cookie: config.jade.sessionCookie,
    },
    timeout: config.jade.timeout,
    responseType: "text",
    maxContentLength: 5 * 1024 * 1024,
    maxRedirects: MAX_REDIRECTS,
    beforeRedirect: assertRedirectAllowed,
  });

  const { results: parsed, flatArray } = parseProposeCitablesResponse(response.data as string);

  // Extract candidate article IDs from the bridge section and validate
  // them by resolving each against jade.io (public GET, no session cookie needed)
  const articleIdMap = await resolveBridgeCandidates(flatArray);

  const results: SearchResult[] = parsed.map((item) => {
    // Extract jurisdiction from neutral citation (reuse existing court -> jurisdiction map)
    const courtMatch = item.neutralCitation.match(/\[\d{4}\]\s+([A-Z]+(?:\s+[A-Z]+)?)\s+\d+/);
    const court = courtMatch?.[1]?.replace(/\s+/g, "");
    const jurisdiction = court ? COURT_TO_JURISDICTION[court] : undefined;
    const yearMatch = item.neutralCitation.match(/\[(\d{4})\]/);

    // Use resolved article ID if available, otherwise fall back to citation search URL
    const resolvedId = articleIdMap.get(normaliseCitation(item.neutralCitation));
    const url = resolvedId ? `https://jade.io/article/${resolvedId}` : item.jadeUrl;

    return {
      title: item.caseName,
      neutralCitation: item.neutralCitation,
      reportedCitation: item.reportedCitation,
      url,
      source: "jade" as const,
      type: options.type,
      jurisdiction,
      year: yearMatch?.[1],
    };
  });

  // Apply jurisdiction filter
  const filtered = options.jurisdiction
    ? results.filter((r) => !r.jurisdiction || r.jurisdiction === options.jurisdiction)
    : results;

  // Apply limit
  const limit = options.limit ?? filtered.length;
  return filtered.slice(0, limit);
}

/**
 * Searches jade.io and returns explicit source status for callers that must
 * distinguish an empty result set from unavailable jade coverage.
 */
export async function searchJadeWithStatus(
  query: string,
  options: SearchOptions,
): Promise<JadeSearchOutcome> {
  if (!config.jade.sessionCookie) {
    return { results: [], status: "not_configured" };
  }

  try {
    return { results: await searchJadeStrict(query, options), status: "ok" };
  } catch (error) {
    // Sanitise AxiosError to prevent session cookie leaking into error messages
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      console.warn(
        `jade.io proposeCitables search failed${status ? ` (HTTP ${status})` : ""} — returning empty results`,
      );
    } else {
      console.warn(
        "jade.io search failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
    return { results: [], status: "failed" };
  }
}

/**
 * Backwards-compatible jade search helper. Returns an empty array when jade is
 * unavailable; use searchJadeWithStatus when source coverage must be explicit.
 */
export async function searchJade(query: string, options: SearchOptions): Promise<SearchResult[]> {
  return (await searchJadeWithStatus(query, options)).results;
}

// ── GWT-RPC Content Fetching ───────────────────────────────────────────

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
export async function fetchJadeArticleContent(
  articleId: number,
  sessionCookie: string,
): Promise<string> {
  const url = `${config.jade.baseUrl}/jadeService.do`;
  const requestBody = buildAvd2Request(articleId);

  const response = await axios.post(url, requestBody, {
    headers: {
      "Content-Type": "text/x-gwt-rpc; charset=UTF-8",
      "X-GWT-Module-Base": JADE_MODULE_BASE,
      "X-GWT-Permutation": JADE_PERMUTATION,
      Origin: "https://jade.io",
      Referer: `https://jade.io/article/${articleId}`,
      "User-Agent": config.jade.userAgent,
      Cookie: sessionCookie,
    },
    timeout: config.jade.timeout,
    responseType: "text",
    // avd2Request responses can be large (700KB+ for HCA decisions)
    maxContentLength: 5 * 1024 * 1024,
    maxRedirects: MAX_REDIRECTS,
    beforeRedirect: assertRedirectAllowed,
  });

  return parseAvd2Response(response.data as string);
}

// ── Citator ────────────────────────────────────────────────────────────

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
export async function searchCitingCases(caseName: string): Promise<CitatorSearchResult> {
  const empty: CitatorSearchResult = { results: [], totalCount: 0 };

  if (!config.jade.sessionCookie) {
    return empty;
  }

  try {
    await jadeRateLimiter.throttle();

    const url = `${config.jade.baseUrl}/jadeService.do`;
    const gwt_headers = {
      "Content-Type": "text/x-gwt-rpc; charset=UTF-8",
      "X-GWT-Module-Base": JADE_MODULE_BASE,
      "X-GWT-Permutation": JADE_PERMUTATION,
      Origin: "https://jade.io",
      Referer: "https://jade.io/",
      "User-Agent": config.jade.userAgent,
      Cookie: config.jade.sessionCookie,
    };

    // Step 1: proposeCitables to get the citable ID
    const proposeBody = buildProposeCitablesRequest(caseName);
    const proposeResponse = await axios.post(url, proposeBody, {
      headers: gwt_headers,
      timeout: config.jade.timeout,
      responseType: "text",
      maxContentLength: 5 * 1024 * 1024,
      maxRedirects: MAX_REDIRECTS,
      beforeRedirect: assertRedirectAllowed,
    });

    const { flatArray } = parseProposeCitablesResponse(proposeResponse.data as string);
    const citableIds = extractCitableIds(flatArray);

    if (citableIds.length === 0) {
      return empty;
    }

    // Use the last citable ID: they appear in reverse order relative to descriptors,
    // so the last one corresponds to the primary (best-match) case.
    const primaryCitableId = citableIds[citableIds.length - 1]!.citableId;

    // Step 2: LeftoverRemoteService.search with the citable ID
    await jadeRateLimiter.throttle();
    const citatorBody = buildCitatorSearchRequest(primaryCitableId);
    const citatorResponse = await axios.post(url, citatorBody, {
      headers: gwt_headers,
      timeout: config.jade.timeout,
      responseType: "text",
      maxContentLength: 5 * 1024 * 1024,
      maxRedirects: MAX_REDIRECTS,
      beforeRedirect: assertRedirectAllowed,
    });

    const { results, totalCount } = parseCitatorResponse(citatorResponse.data as string);
    return { results, totalCount };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      console.warn(
        `jade.io citator search failed${status ? ` (HTTP ${status})` : ""} — returning empty results`,
      );
    } else {
      console.warn(
        "jade.io citator search failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
    return empty;
  }
}
