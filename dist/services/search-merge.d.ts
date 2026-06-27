import type { SearchResult } from "./austlii.js";
/**
 * Deduplicate AustLII case search results, keeping the first occurrence of each
 * neutral citation (falling back to URL when no neutral citation is present).
 */
export declare function mergeCaseSearchResults(austliiResults: SearchResult[], limit?: number): SearchResult[];
//# sourceMappingURL=search-merge.d.ts.map