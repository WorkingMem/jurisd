import axios from "axios";
import * as cheerio from "cheerio";
import { config } from "../config.js";
import { REPORTED_CITATION_PATTERNS } from "../constants.js";

export interface SearchResult {
  title: string;
  citation?: string;
  neutralCitation?: string;
  reportedCitation?: string; // e.g., "(2024) 350 ALR 123"
  url: string;
  source: "austlii" | "source";
  summary?: string;
  jurisdiction?: string;
  year?: string;
  type: "case" | "legislation";
}

export type Jurisdiction =
  | "cth"
  | "vic"
  | "nsw"
  | "qld"
  | "sa"
  | "wa"
  | "tas"
  | "nt"
  | "act"
  | "federal"
  | "nz"
  | "other";
export type SearchMethod =
  | "auto"
  | "title"
  | "phrase"
  | "all"
  | "any"
  | "near"
  | "legis"
  | "boolean";

export interface SearchOptions {
  jurisdiction?: Jurisdiction;
  limit?: number;
  type: "case" | "legislation";
  sortBy?: "relevance" | "date" | "auto";
  method?: SearchMethod;
  offset?: number; // For pagination - skip first N results
}

// Browser-like headers required by AustLII
const AUSTLII_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.austlii.edu.au/forms/search1.html",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-AU,en;q=0.9",
};

interface SearchParams {
  query: string;
  meta: string;
  mask_path?: string;
  method: string;
  offset?: number;
}

/**
 * Extracts reported citation from text.
 * Uses REPORTED_CITATION_PATTERNS from constants.
 */
function extractReportedCitation(text: string): string | undefined {
  for (const pattern of REPORTED_CITATION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
  }
  return undefined;
}

/**
 * Detects if a query looks like a case name (e.g., "X v Y", "Re X")
 * These queries benefit from relevance sorting to find the specific case
 */
function isCaseNameQuery(query: string): boolean {
  // Pattern 1: "X v Y" or "X v. Y" (party vs party)
  if (/\b\w+\s+v\.?\s+\w+/i.test(query)) {
    return true;
  }

  // Pattern 2: "Re X" or "In re X" (matter of X)
  if (/\b(re|in\s+re)\s+\w+/i.test(query)) {
    return true;
  }

  // Pattern 3: Contains citation pattern like [2024] HCA 26
  if (/\[\d{4}\]\s*[A-Z]+\s*\d+/i.test(query)) {
    return true;
  }

  // Pattern 4: Quote marks suggest looking for exact case name
  if (query.includes('"')) {
    return true;
  }

  return false;
}

/**
 * Determines the appropriate sort mode based on query and options
 */
function determineSortMode(query: string, options: SearchOptions): "relevance" | "date" {
  // If explicitly set, use that
  if (options.sortBy === "relevance") {
    return "relevance";
  }
  if (options.sortBy === "date") {
    return "date";
  }

  // Auto mode: detect based on query pattern
  if (options.sortBy === "auto" || !options.sortBy) {
    // For case name queries, use relevance to find the specific case
    if (options.type === "case" && isCaseNameQuery(query)) {
      return "relevance";
    }
    // For topic searches, use date to get recent cases
    return "date";
  }

  return "date";
}

function buildSearchParams(query: string, options: SearchOptions): SearchParams {
  // Determine virtual concordance based on jurisdiction
  // /au for Australian, /nz for New Zealand, /austlii for both
  let meta = "/au";
  let maskPath: string | undefined;

  // Map jurisdiction codes to AustLII path segments
  const australianJurisdictions: Record<string, string> = {
    cth: "cth",
    vic: "vic",
    nsw: "nsw",
    qld: "qld",
    sa: "sa",
    wa: "wa",
    tas: "tas",
    nt: "nt",
    act: "act",
    federal: "cth", // Federal courts (HCA, FCA, FCAFC, etc.) are under au/cases/cth/
  };

  // Handle New Zealand - use /austlii meta with nz mask_path
  if (options.jurisdiction === "nz") {
    meta = "/austlii";
    if (options.type === "case") {
      maskPath = "nz/cases";
    } else if (options.type === "legislation") {
      maskPath = "nz/legis";
    }
  } else {
    // Australian jurisdictions
    const juriPath = options.jurisdiction
      ? australianJurisdictions[options.jurisdiction]
      : undefined;

    // Set mask_path based on type and jurisdiction
    if (options.type === "case") {
      if (juriPath) {
        maskPath = `au/cases/${juriPath}`;
      } else {
        // All cases
        maskPath = "au/cases";
      }
    } else if (options.type === "legislation") {
      if (juriPath) {
        maskPath = `au/legis/${juriPath}`;
      } else {
        // All legislation
        maskPath = "au/legis";
      }
    }
  }

  // Determine search method
  // Default to "auto" which lets AustLII decide, unless explicitly set
  const method = options.method || "auto";

  return {
    query,
    meta,
    mask_path: maskPath,
    method,
    offset: options.offset,
  };
}

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
export async function searchAustLii(
  query: string,
  options: SearchOptions,
): Promise<SearchResult[]> {
  try {
    const searchParams = buildSearchParams(query, options);
    const limit = options.limit ?? 10;

    // Determine sort mode (auto-detect or use explicit setting)
    const sortMode = determineSortMode(query, options);

    const searchUrl = new URL(config.austlii.searchBase);
    searchUrl.searchParams.set("method", searchParams.method);
    searchUrl.searchParams.set("query", searchParams.query);
    searchUrl.searchParams.set("meta", searchParams.meta);
    searchUrl.searchParams.set("results", String(limit));

    // Set mask_path for filtering by type/jurisdiction
    if (searchParams.mask_path) {
      searchUrl.searchParams.set("mask_path", searchParams.mask_path);
    }

    // Set pagination offset if provided
    if (searchParams.offset && searchParams.offset > 0) {
      searchUrl.searchParams.set("offset", String(searchParams.offset));
    }

    // Set sort order based on mode
    if (sortMode === "relevance") {
      searchUrl.searchParams.set("view", "relevance");
    } else {
      searchUrl.searchParams.set("view", "date-latest");
    }

    const response = await axios.get(searchUrl.toString(), {
      headers: AUSTLII_HEADERS,
      timeout: config.austlii.timeout,
    });

    const html = response.data;
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    // Parse search results - AustLII returns results in <li data-count="X." class="multi"> elements
    $("li[data-count].multi").each((_, element) => {
      const $li = $(element);
      const $link = $li.find("a").first();
      const title = $link.text().trim();
      let url = $link.attr("href") || "";

      // Make URL absolute if relative
      if (url && !url.startsWith("http")) {
        // Strip AustLII search-decoration params (stem, synonyms, etc.) but keep the base path
        const [basePath, queryString] = url.split("?");
        let cleanUrl = basePath!;
        if (queryString) {
          const preservedParams = new URLSearchParams();
          const searchDecorations = new Set(["stem", "synonyms", "num", "mask_path", "meta", "query", "method"]);
          for (const [key, val] of new URLSearchParams(queryString)) {
            if (!searchDecorations.has(key)) {
              preservedParams.set(key, val);
            }
          }
          const remaining = preservedParams.toString();
          if (remaining) {
            cleanUrl = `${basePath}?${remaining}`;
          }
        }
        url = `https://www.austlii.edu.au${cleanUrl}`;
      }

      if (title && url) {
        // Always skip journal articles - we only want primary sources
        if (url.includes("/journals/")) {
          return; // Skip journal articles
        }

        // For cases, only include actual case databases
        if (options.type === "case" && !url.includes("/cases/")) {
          return; // Skip non-case results
        }

        // For legislation, only include legislation databases
        if (options.type === "legislation" && !url.includes("/legis/")) {
          return; // Skip non-legislation results
        }

        // Try to extract neutral citation from title
        const citationMatch = title.match(/\[(\d{4})\]\s*([A-Z]+)\s*(\d+)/);
        const neutralCitation = citationMatch ? citationMatch[0] : undefined;
        const year = citationMatch ? citationMatch[1] : undefined;

        // Extract jurisdiction from URL (Australian and New Zealand)
        const auJurisdictionMatch = url.match(/\/au\/cases\/(cth|vic|nsw|qld|sa|wa|tas|nt|act)\//i);
        const nzJurisdictionMatch = url.match(/\/nz\/cases\//i);
        const jurisdiction =
          auJurisdictionMatch?.[1]?.toLowerCase() || (nzJurisdictionMatch ? "nz" : undefined);

        // Extract date from the meta section
        const $meta = $li.find("p.meta");
        const metaText = $meta.text();
        const dateMatch = metaText.match(/(\d{1,2}\s+\w+\s+\d{4})/);
        const dateStr = dateMatch ? dateMatch[1] : undefined;

        // Extract court/database info from meta
        const $courtLink = $meta.find("a").first();
        const court = $courtLink.length > 0 ? $courtLink.text().trim() : undefined;

        // Try to extract reported citation from title
        const reportedCitation = extractReportedCitation(title);

        results.push({
          title,
          citation: undefined,
          neutralCitation,
          reportedCitation,
          url,
          source: "austlii",
          summary: court ? `${court}${dateStr ? ` - ${dateStr}` : ""}` : dateStr,
          jurisdiction,
          year,
          type: options.type,
        });
      }
    });

    // Apply title matching boost when using relevance sorting
    let finalResults = results;
    if (sortMode === "relevance" && isCaseNameQuery(query)) {
      finalResults = boostTitleMatches(results, query);
    }

    return finalResults.slice(0, limit);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`AustLII search failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Boosts results where the title closely matches the query
 * This helps prioritize the actual case being searched for
 */
function boostTitleMatches(results: SearchResult[], query: string): SearchResult[] {
  // Extract case name patterns from query
  const normalizedQuery = query
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .trim();
  const queryWords = new Set(normalizedQuery.split(/\s+/).filter((w) => w.length > 2));

  // Score each result based on title match
  const scored = results.map((result) => {
    const normalizedTitle = result.title
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .trim();
    const titleWords = normalizedTitle.split(/\s+/);

    let score = 0;

    // Count matching words
    const matchingWords = titleWords.filter(
      (word) => word.length > 2 && queryWords.has(word),
    ).length;

    score += matchingWords * 10;

    // Bonus for exact substring match (case insensitive)
    if (normalizedTitle.includes(normalizedQuery)) {
      score += 50;
    }

    // Bonus if title starts with similar text
    const queryStart = normalizedQuery.split(/\s+/).slice(0, 3).join(" ");
    if (normalizedTitle.startsWith(queryStart) && queryStart.length > 5) {
      score += 30;
    }

    // Extract parties from "X v Y" pattern
    const vMatch = query.match(/(\w+)\s+v\.?\s+(\w+)/i);
    if (vMatch && vMatch[1] && vMatch[2]) {
      const party1 = vMatch[1];
      const party2 = vMatch[2];
      const party1Lower = party1.toLowerCase();
      const party2Lower = party2.toLowerCase();

      // Check if both parties appear in title
      if (normalizedTitle.includes(party1Lower) && normalizedTitle.includes(party2Lower)) {
        score += 100; // Strong boost for matching both parties
      } else if (normalizedTitle.includes(party1Lower) || normalizedTitle.includes(party2Lower)) {
        score += 20; // Smaller boost for one party
      }
    }

    return { result, score };
  });

  // Sort by score (descending) and return results
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.result);
}
