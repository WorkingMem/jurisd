import axios from "axios";
import * as cheerio from "cheerio";

export interface SearchResult {
  title: string;
  citation?: string;
  neutralCitation?: string;
  url: string;
  source: "austlii";
  summary?: string;
  jurisdiction?: string;
  year?: string;
  type: "case" | "legislation";
}

export interface SearchOptions {
  jurisdiction?: "cth" | "vic" | "federal" | "other";
  limit?: number;
  type: "case" | "legislation";
  sortBy?: "relevance" | "date" | "auto";
}

const AUSTLII_SEARCH_BASE = "https://classic.austlii.edu.au/cgi-bin/sinosrch.cgi";

interface SearchParams {
  query: string;
  meta: string;
  mask_path?: string;
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
  // Use /austlii meta which searches all Australian databases
  const meta = "/austlii";
  let maskPath: string | undefined;

  return {
    query,
    meta,
    mask_path: maskPath,
  };
}

export async function searchAustLii(
  query: string,
  options: SearchOptions,
): Promise<SearchResult[]> {
  try {
    const searchParams = buildSearchParams(query, options);
    const limit = options.limit ?? 10;

    // Determine sort mode (auto-detect or use explicit setting)
    const sortMode = determineSortMode(query, options);

    const searchUrl = new URL(AUSTLII_SEARCH_BASE);
    searchUrl.searchParams.set("method", "boolean");
    searchUrl.searchParams.set("query", searchParams.query);
    searchUrl.searchParams.set("meta", searchParams.meta);
    searchUrl.searchParams.set("results", String(limit));

    // Set sort order based on mode
    if (sortMode === "relevance") {
      searchUrl.searchParams.set("view", "relevance");
    } else {
      searchUrl.searchParams.set("view", "date");
    }

    const response = await axios.get(searchUrl.toString(), {
      headers: {
        "User-Agent": "auslaw-mcp/0.1.0 (legal research tool)",
      },
      timeout: 15000,
    });

    const html = response.data;
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    // Parse search results - AustLII returns results in an <OL> ordered list
    $("ol li").each((_, element) => {
      const $li = $(element);
      const $link = $li.find("a").first();
      const title = $link.text().trim();
      let url = $link.attr("href") || "";

      // Make URL absolute if relative
      if (url && !url.startsWith("http")) {
        url = `http://classic.austlii.edu.au${url}`;
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

        // Try to extract citation from title
        const citationMatch = title.match(/\[(\d{4})\]\s*([A-Z]+)\s*(\d+)/);
        const neutralCitation = citationMatch ? citationMatch[0] : undefined;
        const year = citationMatch ? citationMatch[1] : undefined;

        // Extract jurisdiction from URL
        const jurisdictionMatch = url.match(/\/au\/cases\/(cth|vic|nsw|qld|sa|wa|tas|nt|act)\//i);
        const jurisdiction = jurisdictionMatch?.[1]?.toLowerCase();

        // Extract summary from <small> tag if present
        const $small = $li.find("small");
        const summary = $small.length > 0 ? $small.text().trim() : undefined;

        results.push({
          title,
          citation: undefined,
          neutralCitation,
          url,
          source: "austlii",
          summary,
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
  const normalizedQuery = query.toLowerCase().replace(/[^\w\s]/g, ' ').trim();
  const queryWords = new Set(normalizedQuery.split(/\s+/).filter(w => w.length > 2));

  // Score each result based on title match
  const scored = results.map(result => {
    const normalizedTitle = result.title.toLowerCase().replace(/[^\w\s]/g, ' ').trim();
    const titleWords = normalizedTitle.split(/\s+/);

    let score = 0;

    // Count matching words
    const matchingWords = titleWords.filter(word =>
      word.length > 2 && queryWords.has(word)
    ).length;

    score += matchingWords * 10;

    // Bonus for exact substring match (case insensitive)
    if (normalizedTitle.includes(normalizedQuery)) {
      score += 50;
    }

    // Bonus if title starts with similar text
    const queryStart = normalizedQuery.split(/\s+/).slice(0, 3).join(' ');
    if (normalizedTitle.startsWith(queryStart) && queryStart.length > 5) {
      score += 30;
    }

    // Extract parties from "X v Y" pattern
    const vMatch = query.match(/(\w+)\s+v\.?\s+(\w+)/i);
    if (vMatch) {
      const [, party1, party2] = vMatch;
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
  return scored.map(s => s.result);
}
