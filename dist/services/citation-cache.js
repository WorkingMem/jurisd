/**
 * jurisd - Local citation cache
 *
 * Persists citations as a JSON file in <cacheDir>/.auslaw/citations.json.
 * Each entry is embedding-ready: metadata fields are rich enough to attach
 * a vector embedding later without a schema migration.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { AUSLAW_CACHE_VERSION, AUSLAW_CACHE_DIR_NAME } from "../constants.js";
const CACHE_FILE_NAME = "citations.json";
// ── Path helpers ──────────────────────────────────────────────────────────────
function getCachePath(cacheDir) {
    return path.join(cacheDir, AUSLAW_CACHE_DIR_NAME, CACHE_FILE_NAME);
}
// ── Core I/O ──────────────────────────────────────────────────────────────────
/** Load the citation cache, returning an empty cache if none exists yet. */
export async function loadCache(cacheDir) {
    const cachePath = getCachePath(cacheDir);
    try {
        const raw = await fs.readFile(cachePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed.version !== undefined && parsed.version > AUSLAW_CACHE_VERSION) {
            console.warn(`jurisd: citation cache at ${cachePath} was written by a newer version ` +
                `(schema v${parsed.version}, current v${AUSLAW_CACHE_VERSION}). ` +
                `Some fields may be ignored. Update jurisd to avoid data loss.`);
        }
        return parsed;
    }
    catch (err) {
        if (err.code === "ENOENT") {
            return {
                version: AUSLAW_CACHE_VERSION,
                projectName: path.basename(cacheDir),
                entries: [],
            };
        }
        throw err;
    }
}
async function saveCache(cacheDir, cache) {
    const cachePath = getCachePath(cacheDir);
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), "utf-8");
}
// ── Cite key generation ───────────────────────────────────────────────────────
/**
 * Generate a unique, biblatex-compatible cite key from a case title and year.
 *
 * Strategy: strip "v", "re", "(No N)", take the first significant word,
 * append the year, then add a suffix letter on collision.
 */
export function generateCiteKey(title, year, existing = []) {
    const stripped = title
        .replace(/\s*\(No\.?\s*\d+\)/gi, "")
        .split(/\s+v\s+/i)[0]
        .replace(/^(re|in re|ex parte)\s+/i, "")
        .replace(/[^a-zA-Z0-9\s]/g, "")
        .trim();
    const firstWord = stripped.split(/\s+/)[0]?.toLowerCase() ?? "unknown";
    const base = year ? `${firstWord}${year}` : firstWord;
    if (!existing.includes(base))
        return base;
    for (const suffix of "abcdefghijklmnopqrstuvwxyz") {
        const key = `${base}${suffix}`;
        if (!existing.includes(key))
            return key;
    }
    return `${base}${crypto.randomBytes(2).toString("hex")}`;
}
// ── biblatex helpers ──────────────────────────────────────────────────────────
function buildBibFields(entry) {
    const fields = { title: entry.title };
    if (entry.year !== undefined)
        fields["year"] = String(entry.year);
    if (entry.neutralCitation)
        fields["citation"] = entry.neutralCitation;
    if (entry.reportedCitation)
        fields["reporter"] = entry.reportedCitation;
    if (entry.url)
        fields["url"] = entry.url;
    if (entry.aglc4Full)
        fields["note"] = entry.aglc4Full;
    if (entry.court)
        fields["court"] = entry.court;
    if (entry.jurisdiction)
        fields["jurisdiction"] = entry.jurisdiction;
    return fields;
}
function escapeBibValue(s) {
    return s.replace(/[{}]/g, (c) => `\\${c}`);
}
function formatBibEntry(entry) {
    const lines = Object.entries(entry.bibFields)
        .map(([k, v]) => `  ${k.padEnd(12)} = {${escapeBibValue(v)}}`)
        .join(",\n");
    return `@${entry.bibType}{${entry.citeKey},\n${lines}\n}`;
}
// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Add or update a citation entry.
 * Matches on neutralCitation, aglc4Full, or url — whichever is present.
 * Returns the citeKey assigned to the entry.
 *
 * Note: uses a load-mutate-save pattern with no file lock. Concurrent calls
 * from the same process (e.g. parallel MCP tool invocations under HTTP
 * transport) can silently lose each other's writes. Safe for the default
 * single-client stdio transport.
 */
export async function upsertCitation(cacheDir, input) {
    const cache = await loadCache(cacheDir);
    const existing = cache.entries.find((e) => (input.neutralCitation && e.neutralCitation === input.neutralCitation) ||
        e.aglc4Full === input.aglc4Full ||
        e.url === input.url);
    if (existing) {
        existing.aglc4Full = input.aglc4Full;
        existing.updatedAt = new Date().toISOString();
        if (input.keywords?.length) {
            existing.keywords = [...new Set([...(existing.keywords ?? []), ...input.keywords])];
        }
        if (input.summary)
            existing.summary = input.summary;
        if (input.document && !existing.documents.includes(input.document)) {
            existing.documents.push(input.document);
        }
        if (input.document && input.footnoteNumber !== undefined) {
            existing.footnoteNumbers[input.document] = input.footnoteNumber;
        }
        existing.bibFields = buildBibFields(existing);
        await saveCache(cacheDir, cache);
        return existing.citeKey;
    }
    const existingKeys = cache.entries.map((e) => e.citeKey);
    const citeKey = generateCiteKey(input.title, input.year, existingKeys);
    const now = new Date().toISOString();
    const entry = {
        citeKey,
        id: crypto.randomUUID(),
        title: input.title,
        neutralCitation: input.neutralCitation,
        reportedCitation: input.reportedCitation,
        aglc4Full: input.aglc4Full,
        url: input.url,
        type: input.type ?? "case",
        jurisdiction: input.jurisdiction,
        year: input.year,
        court: input.court,
        keywords: input.keywords ?? [],
        summary: input.summary,
        documents: input.document ? [input.document] : [],
        footnoteNumbers: input.document && input.footnoteNumber !== undefined
            ? { [input.document]: input.footnoteNumber }
            : {},
        addedAt: now,
        updatedAt: now,
        bibType: input.type === "case" || input.type === undefined ? "jurisdiction" : "misc",
        bibFields: {},
    };
    entry.bibFields = buildBibFields(entry);
    cache.entries.push(entry);
    await saveCache(cacheDir, cache);
    return citeKey;
}
/**
 * Retrieve a cached citation by cite key, normalised AGLC4 string,
 * neutral citation, or case title. Returns null if not found.
 */
export async function getCitation(cacheDir, keyOrCitation) {
    const cache = await loadCache(cacheDir);
    const q = keyOrCitation.replace(/\s+/g, " ").trim();
    return (cache.entries.find((e) => e.citeKey === q ||
        e.aglc4Full === q ||
        (e.neutralCitation && e.neutralCitation === q) ||
        e.title === q) ?? null);
}
/**
 * List all cached citations, optionally filtered to a specific document.
 */
export async function listCitations(cacheDir, document) {
    const cache = await loadCache(cacheDir);
    if (!document)
        return cache.entries;
    return cache.entries.filter((e) => e.documents.includes(document));
}
/**
 * Export cached citations as a .bib string.
 * Optionally filter to a single document.
 */
export async function exportBib(cacheDir, document) {
    const entries = await listCitations(cacheDir, document);
    if (entries.length === 0)
        return "";
    return entries.map(formatBibEntry).join("\n\n");
}
/**
 * Replace the citedBy list on an existing cache entry and record when it was
 * fetched.  Overwrites any prior citedBy array so callers always store the
 * most recent snapshot from jade.io.
 *
 * Note: same load-mutate-save limitation as upsertCitation.
 */
export async function updateCitedBy(cacheDir, citeKey, refs, totalCount, fetchedAt) {
    const cache = await loadCache(cacheDir);
    const entry = cache.entries.find((e) => e.citeKey === citeKey);
    if (!entry)
        return;
    entry.citedBy = refs;
    entry.citedByFetchedAt = fetchedAt ?? new Date().toISOString();
    entry.citedByTotalCount = totalCount;
    entry.updatedAt = new Date().toISOString();
    await saveCache(cacheDir, cache);
}
/**
 * Update source-download fields on a specific CitedByRef within a parent entry.
 * The ref is matched by neutralCitation.
 *
 * Note: same load-mutate-save limitation as upsertCitation.
 */
export async function updateCitedBySource(cacheDir, parentCiteKey, refNeutralCitation, fields) {
    const cache = await loadCache(cacheDir);
    const entry = cache.entries.find((e) => e.citeKey === parentCiteKey);
    if (!entry?.citedBy)
        return;
    const ref = entry.citedBy.find((r) => r.neutralCitation === refNeutralCitation);
    if (!ref)
        return;
    Object.assign(ref, fields);
    entry.updatedAt = new Date().toISOString();
    await saveCache(cacheDir, cache);
}
/**
 * Update source-related fields on an existing cache entry.
 * Used by the source-store after a successful fetch.
 *
 * Note: same load-mutate-save limitation as upsertCitation — not safe for
 * concurrent writes.
 */
export async function updateSourceFields(cacheDir, citeKey, fields) {
    const cache = await loadCache(cacheDir);
    const entry = cache.entries.find((e) => e.citeKey === citeKey);
    if (!entry)
        return;
    Object.assign(entry, fields);
    entry.updatedAt = new Date().toISOString();
    await saveCache(cacheDir, cache);
}
//# sourceMappingURL=citation-cache.js.map