/**
 * OALC (Open Australian Legal Corpus) DuckDB seam.
 *
 * The OALC corpus is a local JSONL file (~8.8 GB) at
 * `~/oalc-data/corpus_published.jsonl` (default; override with
 * AUSLAW_OALC_SOURCE). Each line is a JSON object with the schema:
 *
 *   version_id, type, jurisdiction, source, mime, date, citation,
 *   url, when_scraped, text
 *
 * This module provides two lookup functions that query the corpus via
 * DuckDB's `read_json_auto` / JSONL scanning without loading the whole
 * file into memory:
 *
 *   - {@link lookupByUrl}   — find a document by its canonical URL
 *   - {@link lookupByCitation} — find a document by its citation string
 *
 * Both return an {@link OalcDocument} or null when not found.
 *
 * The DuckDB connection is created lazily on first use and cached for the
 * lifetime of the process. It is intentionally in-memory (`:memory:`) since
 * we only scan the JSONL; we do not persist any derived tables here.
 *
 * The module degrades gracefully when @duckdb/node-api is not installed:
 * both lookup functions return null and a one-time warning is logged.
 */

import * as fs from "node:fs";
import { config } from "../config.js";

/** A single document record from the OALC corpus. */
export interface OalcDocument {
  version_id: string;
  type: string;
  jurisdiction: string;
  source: string;
  mime: string;
  date: string;
  citation: string;
  url: string;
  when_scraped: string;
  text: string;
}

/** Internal: cached DuckDB connection state. */
interface DbState {
  conn: import("@duckdb/node-api").DuckDBConnection;
  corpusPath: string;
}

let _dbState: DbState | null = null;
let _duckdbUnavailable = false;

/**
 * Lazily load @duckdb/node-api. Returns the module or null when not installed.
 */
async function tryLoadDuckDB(): Promise<typeof import("@duckdb/node-api") | null> {
  if (_duckdbUnavailable) return null;
  try {
    return await import("@duckdb/node-api");
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND"
    ) {
      _duckdbUnavailable = true;
      console.warn(
        "[oalc] @duckdb/node-api is not installed. OALC corpus fallback is disabled. " +
          "Run: npm install @duckdb/node-api",
      );
      return null;
    }
    throw err;
  }
}

/**
 * Return (creating if necessary) the shared DuckDB connection.
 * Returns null when DuckDB is unavailable or the corpus file is missing.
 */
async function getConnection(): Promise<DbState | null> {
  if (_dbState) return _dbState;

  const duckdb = await tryLoadDuckDB();
  if (!duckdb) return null;

  const corpusPath = config.oalc.source;

  if (!fs.existsSync(corpusPath)) {
    console.warn(
      `[oalc] Corpus file not found at ${corpusPath}. ` +
        "Set AUSLAW_OALC_SOURCE to a valid path or disable OALC with AUSLAW_OALC_ENABLED=false.",
    );
    return null;
  }

  const instance = await duckdb.DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  _dbState = { conn, corpusPath };
  return _dbState;
}

/**
 * Run a parameterised DuckDB query against the corpus and return the first
 * matching row as an {@link OalcDocument}, or null.
 *
 * The query must SELECT exactly the ten OALC fields in order.
 */
async function queryFirst(sql: string): Promise<OalcDocument | null> {
  if (!config.oalc.enabled) return null;

  const state = await getConnection();
  if (!state) return null;

  const result = await state.conn.run(sql);
  const rows = await result.getRows();

  if (!rows || rows.length === 0) return null;

  const row = rows[0]!;
  return {
    version_id: String(row[0] ?? ""),
    type: String(row[1] ?? ""),
    jurisdiction: String(row[2] ?? ""),
    source: String(row[3] ?? ""),
    mime: String(row[4] ?? ""),
    date: String(row[5] ?? ""),
    citation: String(row[6] ?? ""),
    url: String(row[7] ?? ""),
    when_scraped: String(row[8] ?? ""),
    text: String(row[9] ?? ""),
  };
}

/** Escape a string for safe interpolation into a DuckDB SQL literal. */
function sqlEscapeString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Look up a document in the OALC corpus by its canonical URL.
 *
 * @param url - Canonical URL of the document (e.g. an AustLII judgment URL).
 * @returns The matching {@link OalcDocument} or null when not found or DuckDB
 *          is unavailable.
 */
export async function lookupByUrl(url: string): Promise<OalcDocument | null> {
  const state = await getConnection();
  if (!state) return null;

  const escaped = sqlEscapeString(url);
  const sql = `
    SELECT version_id, type, jurisdiction, source, mime, date,
           citation, url, when_scraped, text
    FROM read_json_auto('${sqlEscapeString(state.corpusPath)}')
    WHERE url = '${escaped}'
    LIMIT 1
  `;
  return queryFirst(sql);
}

/**
 * Look up a document in the OALC corpus by its citation string.
 *
 * The match is exact (case-sensitive). For case-insensitive matching
 * callers should normalise the citation before passing it in.
 *
 * @param citation - Citation string (e.g. "Mabo v Queensland (No 2) [1992] HCA 23").
 * @returns The matching {@link OalcDocument} or null when not found or DuckDB
 *          is unavailable.
 */
export async function lookupByCitation(citation: string): Promise<OalcDocument | null> {
  const state = await getConnection();
  if (!state) return null;

  const escaped = sqlEscapeString(citation);
  const sql = `
    SELECT version_id, type, jurisdiction, source, mime, date,
           citation, url, when_scraped, text
    FROM read_json_auto('${sqlEscapeString(state.corpusPath)}')
    WHERE citation = '${escaped}'
    LIMIT 1
  `;
  return queryFirst(sql);
}

/**
 * Close and reset the cached DuckDB connection.
 * Primarily useful in tests to reset module state between runs.
 */
export function resetConnection(): void {
  _dbState = null;
  _duckdbUnavailable = false;
}
