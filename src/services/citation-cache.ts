/**
 * AusLaw MCP - Local citation cache
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

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CachedCitation {
  /** biblatex-compatible cite key, unique within this project. */
  citeKey: string;
  /** UUID for graph-edge references between entries. */
  id: string;

  // Core citation data
  title: string;
  neutralCitation?: string;
  reportedCitation?: string;
  /** Canonical AGLC4-formatted full citation string. */
  aglc4Full: string;
  /** Short form once the agent has assigned one (AGLC4 r 1.4.3). */
  aglc4Short?: string;

  // Source link
  url: string;
  /** Relative path from cacheDir, e.g. "sources/mabo1992.md". */
  sourceFile?: string;
  /** SHA-256 hex of source text — used for offline change detection. */
  contentHash?: string;
  sourceFetchedAt?: string;
  /** HTTP ETag for conditional GET freshness checks. */
  sourceEtag?: string;
  /** HTTP Last-Modified for conditional GET freshness checks. */
  sourceLastModified?: string;

  // Classification — used as embedding metadata
  type: "case" | "legislation" | "secondary" | "treaty";
  jurisdiction?: string;
  year?: number;
  court?: string;
  keywords?: string[];
  summary?: string;

  // Embedding slot — populated by a future kannon-2 / local-model integration
  embedding?: number[];
  embeddingModel?: string;

  // Project tracking
  /** Logical document IDs within this project that cite this source. */
  documents: string[];
  /** Maps document → footnote number of first citation in that document. */
  footnoteNumbers: Record<string, number>;
  addedAt: string;
  updatedAt: string;

  // biblatex export
  bibType: "jurisdiction" | "misc" | "incollection" | "article";
  bibFields: Record<string, string>;
}

export interface CitationCache {
  version: number;
  projectName: string;
  entries: CachedCitation[];
}

export interface UpsertInput {
  title: string;
  neutralCitation?: string;
  reportedCitation?: string;
  aglc4Full: string;
  url: string;
  type?: "case" | "legislation" | "secondary" | "treaty";
  jurisdiction?: string;
  year?: number;
  court?: string;
  keywords?: string[];
  summary?: string;
  /** Logical document name to associate with this citation. */
  document?: string;
  /** Footnote number in `document` where this citation first appears. */
  footnoteNumber?: number;
}

// ── Path helpers ──────────────────────────────────────────────────────────────

function getCachePath(cacheDir: string): string {
  return path.join(cacheDir, AUSLAW_CACHE_DIR_NAME, CACHE_FILE_NAME);
}

// ── Core I/O ──────────────────────────────────────────────────────────────────

/** Load the citation cache, returning an empty cache if none exists yet. */
export async function loadCache(cacheDir: string): Promise<CitationCache> {
  const cachePath = getCachePath(cacheDir);
  try {
    const raw = await fs.readFile(cachePath, "utf-8");
    const parsed = JSON.parse(raw) as CitationCache;
    if (parsed.version !== undefined && parsed.version > AUSLAW_CACHE_VERSION) {
      console.warn(
        `auslaw-mcp: citation cache at ${cachePath} was written by a newer version ` +
          `(schema v${parsed.version}, current v${AUSLAW_CACHE_VERSION}). ` +
          `Some fields may be ignored. Update auslaw-mcp to avoid data loss.`,
      );
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        version: AUSLAW_CACHE_VERSION,
        projectName: path.basename(cacheDir),
        entries: [],
      };
    }
    throw err;
  }
}

async function saveCache(cacheDir: string, cache: CitationCache): Promise<void> {
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
export function generateCiteKey(title: string, year?: number, existing: string[] = []): string {
  const stripped = title
    .replace(/\s*\(No\.?\s*\d+\)/gi, "")
    .split(/\s+v\s+/i)[0]!
    .replace(/^(re|in re|ex parte)\s+/i, "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .trim();

  const firstWord = stripped.split(/\s+/)[0]?.toLowerCase() ?? "unknown";
  const base = year ? `${firstWord}${year}` : firstWord;

  if (!existing.includes(base)) return base;

  for (const suffix of "abcdefghijklmnopqrstuvwxyz") {
    const key = `${base}${suffix}`;
    if (!existing.includes(key)) return key;
  }

  return `${base}${crypto.randomBytes(2).toString("hex")}`;
}

// ── biblatex helpers ──────────────────────────────────────────────────────────

function buildBibFields(
  entry: Omit<CachedCitation, "bibFields" | "bibType">,
): Record<string, string> {
  const fields: Record<string, string> = { title: entry.title };
  if (entry.year !== undefined) fields["year"] = String(entry.year);
  if (entry.neutralCitation) fields["citation"] = entry.neutralCitation;
  if (entry.reportedCitation) fields["reporter"] = entry.reportedCitation;
  if (entry.url) fields["url"] = entry.url;
  if (entry.aglc4Full) fields["note"] = entry.aglc4Full;
  if (entry.court) fields["court"] = entry.court;
  if (entry.jurisdiction) fields["jurisdiction"] = entry.jurisdiction;
  return fields;
}

function escapeBibValue(s: string): string {
  return s.replace(/[{}]/g, (c) => `\\${c}`);
}

function formatBibEntry(entry: CachedCitation): string {
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
export async function upsertCitation(cacheDir: string, input: UpsertInput): Promise<string> {
  const cache = await loadCache(cacheDir);

  const existing = cache.entries.find(
    (e) =>
      (input.neutralCitation && e.neutralCitation === input.neutralCitation) ||
      e.aglc4Full === input.aglc4Full ||
      e.url === input.url,
  );

  if (existing) {
    existing.aglc4Full = input.aglc4Full;
    existing.updatedAt = new Date().toISOString();
    if (input.keywords?.length) {
      existing.keywords = [...new Set([...(existing.keywords ?? []), ...input.keywords])];
    }
    if (input.summary) existing.summary = input.summary;
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

  const entry: CachedCitation = {
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
    footnoteNumbers:
      input.document && input.footnoteNumber !== undefined
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
export async function getCitation(
  cacheDir: string,
  keyOrCitation: string,
): Promise<CachedCitation | null> {
  const cache = await loadCache(cacheDir);
  const q = keyOrCitation.replace(/\s+/g, " ").trim();
  return (
    cache.entries.find(
      (e) =>
        e.citeKey === q ||
        e.aglc4Full === q ||
        (e.neutralCitation && e.neutralCitation === q) ||
        e.title === q,
    ) ?? null
  );
}

/**
 * List all cached citations, optionally filtered to a specific document.
 */
export async function listCitations(
  cacheDir: string,
  document?: string,
): Promise<CachedCitation[]> {
  const cache = await loadCache(cacheDir);
  if (!document) return cache.entries;
  return cache.entries.filter((e) => e.documents.includes(document));
}

/**
 * Export cached citations as a .bib string.
 * Optionally filter to a single document.
 */
export async function exportBib(cacheDir: string, document?: string): Promise<string> {
  const entries = await listCitations(cacheDir, document);
  if (entries.length === 0) return "";
  return entries.map(formatBibEntry).join("\n\n");
}

/**
 * Update source-related fields on an existing cache entry.
 * Used by the source-store after a successful fetch.
 *
 * Note: same load-mutate-save limitation as upsertCitation — not safe for
 * concurrent writes.
 */
export async function updateSourceFields(
  cacheDir: string,
  citeKey: string,
  fields: {
    sourceFile?: string;
    contentHash?: string;
    sourceFetchedAt?: string;
    sourceEtag?: string;
    sourceLastModified?: string;
  },
): Promise<void> {
  const cache = await loadCache(cacheDir);
  const entry = cache.entries.find((e) => e.citeKey === citeKey);
  if (!entry) return;
  Object.assign(entry, fields);
  entry.updatedAt = new Date().toISOString();
  await saveCache(cacheDir, cache);
}
