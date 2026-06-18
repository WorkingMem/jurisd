/**
 * Merge case search results from removed.invalid and AustLII.
 * Prefers removed.invalid when neutral citations collide.
 */
export function mergeCaseSearchResults(austliiResults, upstreamResults, limit) {
    const seen = new Map();
    for (const result of [...upstreamResults, ...austliiResults]) {
        const key = result.neutralCitation ?? result.url;
        if (!seen.has(key)) {
            seen.set(key, result);
        }
    }
    const merged = [...seen.values()];
    return limit ? merged.slice(0, limit) : merged;
}
//# sourceMappingURL=search-merge.js.map