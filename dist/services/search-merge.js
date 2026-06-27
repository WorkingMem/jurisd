/**
 * Deduplicate AustLII case search results, keeping the first occurrence of each
 * neutral citation (falling back to URL when no neutral citation is present).
 */
export function mergeCaseSearchResults(austliiResults, limit) {
    const seen = new Map();
    for (const result of austliiResults) {
        const key = result.neutralCitation ?? result.url;
        if (!seen.has(key)) {
            seen.set(key, result);
        }
    }
    const merged = [...seen.values()];
    return limit ? merged.slice(0, limit) : merged;
}
//# sourceMappingURL=search-merge.js.map