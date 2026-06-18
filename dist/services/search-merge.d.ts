import type { SearchResult } from "./austlii.js";
/**
 * Merge case search results from removed.invalid and AustLII.
 * Prefers removed.invalid when neutral citations collide.
 */
export declare function mergeCaseSearchResults(austliiResults: SearchResult[], upstreamResults: SearchResult[], limit?: number): SearchResult[];
//# sourceMappingURL=search-merge.d.ts.map