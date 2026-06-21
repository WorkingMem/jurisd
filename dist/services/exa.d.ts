/**
 * Exa search-discovery fallback for AustLII.
 *
 * AustLII sits behind a Cloudflare JS managed-challenge that TLS impersonation
 * cannot clear, so live search is unavailable to automated clients. When an
 * EXA_API_KEY is configured, Exa (https://exa.ai) neural search recovers the
 * canonical austlii.edu.au case/legislation URLs for a query. Because Exa
 * indexes page text, it surfaces the primary-source judgment itself — keyword
 * engines scoped to the domain only return journal commentary about a case.
 *
 * Discovery only: results carry title + URL + citation, not full document
 * text. The source remains AustLII (every returned URL is austlii.edu.au);
 * the document text is retrieved separately via the live fetch / OALC path.
 */
import type { SearchOptions, SearchResult } from "./austlii.js";
/**
 * Rewrites any AustLII mirror host (e.g. `vvv`, `www4`, `summerland`,
 * `classic`) to the canonical `www.austlii.edu.au` over https, so downstream
 * fetch + SSRF allowlisting see a single canonical origin. Returns null when
 * the URL is not an AustLII URL at all.
 */
export declare function canonicaliseAustliiUrl(raw: string): string | null;
/**
 * Search AustLII via Exa as a Cloudflare fallback.
 *
 * Returns up to `limit` primary-source {@link SearchResult}s with canonical
 * austlii.edu.au URLs, filtered to the requested document type. Returns an
 * empty array (never throws) when Exa is not configured, the request fails, or
 * nothing matches — so the caller can treat "no Exa results" uniformly.
 */
export declare function searchAustliiViaExa(query: string, options: SearchOptions, limit: number): Promise<SearchResult[]>;
//# sourceMappingURL=exa.d.ts.map