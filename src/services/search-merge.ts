import type { SearchResult } from "./austlii.js";

/**
 * Merge case search results from removed.invalid and AustLII.
 * Prefers removed.invalid when neutral citations collide.
 */
export function mergeCaseSearchResults(
  austliiResults: SearchResult[],
  upstreamResults: SearchResult[],
  limit?: number,
): SearchResult[] {
  const seen = new Map<string, SearchResult>();
  for (const result of [...upstreamResults, ...austliiResults]) {
    const key = result.neutralCitation ?? result.url;
    if (!seen.has(key)) {
      seen.set(key, result);
    }
  }
  const merged = [...seen.values()];
  return limit ? merged.slice(0, limit) : merged;
}
