/**
 * Merge case search results from jade.io and AustLII.
 * Prefers jade.io when neutral citations collide.
 */
export function mergeCaseSearchResults(austliiResults, jadeResults, limit) {
    const seen = new Map();
    for (const result of [...jadeResults, ...austliiResults]) {
        const key = result.neutralCitation ?? result.url;
        if (!seen.has(key)) {
            seen.set(key, result);
        }
    }
    const merged = [...seen.values()];
    return limit ? merged.slice(0, limit) : merged;
}
//# sourceMappingURL=search-merge.js.map