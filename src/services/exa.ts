/**
 * Exa search-discovery fallback for AustLII.
 *
 * AustLII sits behind a Cloudflare JS managed-challenge that TLS impersonation
 * cannot clear, so live search is unavailable to automated clients. When an
 * EXA_API_KEY is configured, Exa (https://exa.ai) search discovery recovers the
 * canonical austlii.edu.au case/legislation URLs for a query. Because Exa
 * indexes page text, it can surface the primary-source judgment itself when
 * generic search engines only return commentary about a case.
 *
 * Discovery only: results carry title + URL + citation, not full document
 * text. The source remains AustLII (every returned URL is austlii.edu.au);
 * the document text is retrieved separately via the live fetch / OALC path.
 */

import { config } from "../config.js";
import type { SearchOptions, SearchResult } from "./austlii.js";
import { extractReportedCitation } from "./austlii.js";
import { austliiUrlToNeutralCitation } from "./austlii-url.js";
import { RateLimiter } from "../utils/rate-limiter.js";

/** Exa is a paid API; a light cap avoids accidental bursts. */
const exaRateLimiter = new RateLimiter(30);

const EXA_SEARCH_ENDPOINT = "https://api.exa.ai/search";
const EXA_SEARCH_TYPES = new Set([
  "auto",
  "instant",
  "fast",
  "deep-lite",
  "deep",
  "deep-reasoning",
]);

interface ExaResult {
  url?: string;
  title?: string;
}

interface ExaResponse {
  results?: ExaResult[];
}

export type ExaSearchStatus = "ok" | "not_configured" | "failed";

export interface ExaSearchOutcome {
  results: SearchResult[];
  status: ExaSearchStatus;
}

function normaliseExaSearchType(raw: string): string {
  return EXA_SEARCH_TYPES.has(raw) ? raw : "auto";
}

/**
 * Rewrites any AustLII mirror host (e.g. `vvv`, `www4`, `summerland`,
 * `classic`) to the canonical `www.austlii.edu.au` over https, so downstream
 * fetch + SSRF allowlisting see a single canonical origin. Returns null when
 * the URL is not an AustLII URL at all.
 */
export function canonicaliseAustliiUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "austlii.edu.au" && !host.endsWith(".austlii.edu.au")) {
    return null;
  }
  parsed.protocol = "https:";
  parsed.hostname = "www.austlii.edu.au";
  parsed.port = "";
  return parsed.toString();
}

/** Extract a neutral citation token (e.g. "[2018] HCA 9") from free text. */
function neutralCitationFromText(text: string): string | undefined {
  const m = text.match(/\[(\d{4})\]\s*([A-Z]+)\s*(\d+)/);
  return m ? m[0] : undefined;
}

/** Derive an AustLII jurisdiction code from a canonical AustLII URL. */
function jurisdictionFromUrl(url: string): string | undefined {
  const au = url.match(/\/au\/(?:cases|legis)\/(cth|vic|nsw|qld|sa|wa|tas|nt|act)\//i);
  if (au?.[1]) return au[1].toLowerCase();
  return /\/nz\//i.test(url) ? "nz" : undefined;
}

function requestedJurisdiction(options: SearchOptions): string | undefined {
  if (!options.jurisdiction || options.jurisdiction === "other") {
    return undefined;
  }
  return options.jurisdiction === "federal" ? "cth" : options.jurisdiction;
}

function matchesRequestedJurisdiction(url: string, options: SearchOptions): boolean {
  const requested = requestedJurisdiction(options);
  if (!requested) {
    return true;
  }
  return jurisdictionFromUrl(url) === requested;
}

/**
 * Search AustLII via Exa as a Cloudflare fallback.
 *
 * Returns up to `limit` primary-source {@link SearchResult}s with canonical
 * austlii.edu.au URLs, filtered to the requested document type and jurisdiction.
 */
export async function searchAustliiViaExaWithStatus(
  query: string,
  options: SearchOptions,
  limit: number,
): Promise<ExaSearchOutcome> {
  const apiKey = config.exa.apiKey;
  if (!apiKey) {
    return { results: [], status: "not_configured" };
  }

  // Over-request so post-filtering to primary sources still fills the limit.
  const numResults = Math.min(Math.max(limit * 3, config.exa.maxResults), 25);
  const searchType = normaliseExaSearchType(config.exa.searchType);

  let json: ExaResponse;
  try {
    await exaRateLimiter.throttle();
    const resp = await fetch(EXA_SEARCH_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        query,
        type: searchType,
        numResults,
        includeDomains: ["austlii.edu.au"],
      }),
      signal: AbortSignal.timeout(config.exa.timeout),
    });
    if (!resp.ok) {
      return { results: [], status: "failed" };
    }
    json = (await resp.json()) as ExaResponse;
  } catch {
    return { results: [], status: "failed" };
  }

  const wantLegis = options.type === "legislation";
  const seen = new Set<string>();
  const out: SearchResult[] = [];

  for (const r of json.results ?? []) {
    if (!r.url) continue;
    const url = canonicaliseAustliiUrl(r.url);
    if (!url) continue;

    const isCase = /\/cases\//.test(url);
    const isLegis = /\/legis\//.test(url);
    // Keep only the requested primary-source type; drop journals/anything else.
    if (wantLegis ? !isLegis : !isCase) continue;
    if (!matchesRequestedJurisdiction(url, options)) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    const title = (r.title ?? "").trim() || url;
    const neutralCitation =
      neutralCitationFromText(title) ?? austliiUrlToNeutralCitation(url) ?? undefined;

    out.push({
      title,
      citation: undefined,
      neutralCitation,
      reportedCitation: extractReportedCitation(title),
      url,
      source: "austlii",
      discoverySource: "exa-fallback",
      summary: undefined,
      jurisdiction: jurisdictionFromUrl(url),
      year: neutralCitation?.match(/\[(\d{4})\]/)?.[1],
      type: options.type,
    });
    if (out.length >= limit) break;
  }

  return { results: out, status: "ok" };
}

export async function searchAustliiViaExa(
  query: string,
  options: SearchOptions,
  limit: number,
): Promise<SearchResult[]> {
  return (await searchAustliiViaExaWithStatus(query, options, limit)).results;
}
