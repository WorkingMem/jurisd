/**
 * AusLaw MCP - Source store
 *
 * Downloads and persists source documents as local markdown files.
 * Uses HTTP ETag / Last-Modified for conditional-GET freshness checks so that
 * re-fetching skips the network when the primary source has not changed.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import axios from "axios";
import { fetchDocumentText } from "./fetcher.js";
import { assertFetchableUrl } from "../utils/url-guard.js";

export interface FreshnessResult {
  /** True when the server confirmed the local copy is current (HTTP 304). */
  fresh: boolean;
  /** ETag from the server response (may be updated even on 304). */
  etag?: string;
  /** Last-Modified from the server response. */
  lastModified?: string;
}

export interface StoreSourceResult {
  /** Absolute path of the written (or already-current) file. */
  path: string;
  /** True when the file content was updated or created during this call. */
  changed: boolean;
  etag?: string;
  lastModified?: string;
  contentHash: string;
}

/**
 * Issue a conditional HEAD request to check whether the local copy of a
 * source document is still current.
 *
 * Returns `fresh: true` (HTTP 304) or `fresh: false` (HTTP 200 / error).
 * Network errors are treated as stale so the caller falls back to re-fetching.
 */
export async function checkSourceFreshness(
  url: string,
  etag?: string,
  lastModified?: string,
): Promise<FreshnessResult> {
  try {
    assertFetchableUrl(url);
    const headers: Record<string, string> = {};
    if (etag) headers["If-None-Match"] = etag;
    if (lastModified) headers["If-Modified-Since"] = lastModified;

    const response = await axios.head(url, {
      headers,
      validateStatus: (s) => s === 200 || s === 304,
      timeout: 10_000,
    });

    return {
      fresh: response.status === 304,
      etag: (response.headers["etag"] as string) ?? undefined,
      lastModified: (response.headers["last-modified"] as string) ?? undefined,
    };
  } catch {
    // Network or status errors — treat as stale so the caller re-fetches
    return { fresh: false };
  }
}

/**
 * Download a source document and save it as a markdown file under `sourcesDir`.
 *
 * Freshness check flow:
 * 1. If `cached` provides ETag/Last-Modified, issue a conditional HEAD first.
 *    HTTP 304 → local copy is current; return without re-downloading.
 * 2. Otherwise fetch full content, compute SHA-256, compare to `cached.contentHash`.
 *    Only write to disk when the hash differs.
 * 3. Issue a follow-up HEAD to capture current ETag/Last-Modified for the
 *    next freshness check (skipped when the primary URL does not return them).
 *
 * @returns Path of the file, whether it changed, and HTTP cache headers.
 */
export async function storeSource(
  citeKey: string,
  url: string,
  cached: {
    contentHash?: string;
    sourceEtag?: string;
    sourceLastModified?: string;
  } | null,
  sourcesDir: string,
): Promise<StoreSourceResult> {
  const filePath = path.join(sourcesDir, `${citeKey}.md`);

  // Freshness check when we have prior ETag or Last-Modified
  if (cached?.sourceEtag || cached?.sourceLastModified) {
    const freshness = await checkSourceFreshness(url, cached.sourceEtag, cached.sourceLastModified);
    if (freshness.fresh && cached.contentHash) {
      return {
        path: filePath,
        changed: false,
        etag: freshness.etag ?? cached.sourceEtag,
        lastModified: freshness.lastModified ?? cached.sourceLastModified,
        contentHash: cached.contentHash,
      };
    }
  }

  // Full content fetch
  const doc = await fetchDocumentText(url);
  const text = doc.text;
  const contentHash = crypto.createHash("sha256").update(text, "utf-8").digest("hex");
  const changed = cached?.contentHash !== contentHash;

  if (changed) {
    await fs.mkdir(sourcesDir, { recursive: true });
    const markdown = `> Source: ${url}\n\n${text}`;
    await fs.writeFile(filePath, markdown, "utf-8");
  }

  // Attempt HEAD to capture ETag/Last-Modified for future freshness checks.
  // Non-fatal — many AustLII responses do not carry these headers.
  let etag: string | undefined;
  let lastModified: string | undefined;
  try {
    assertFetchableUrl(url);
    const headResp = await axios.head(url, { timeout: 10_000 });
    etag = (headResp.headers["etag"] as string) ?? undefined;
    lastModified = (headResp.headers["last-modified"] as string) ?? undefined;
  } catch {
    // Non-fatal
  }

  return { path: filePath, changed, etag, lastModified, contentHash };
}
