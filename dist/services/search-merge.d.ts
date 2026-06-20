import type { SearchResult } from "./austlii.js";
/**
 * Merge case search results from jade.io and AustLII.
 * Prefers jade.io when neutral citations collide.
 */
export declare function mergeCaseSearchResults(austliiResults: SearchResult[], jadeResults: SearchResult[], limit?: number): SearchResult[];
//# sourceMappingURL=search-merge.d.ts.map