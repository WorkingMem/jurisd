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
import type { SearchOptions, SearchResult } from "./austlii.js";
export type ExaSearchStatus = "ok" | "not_configured" | "failed";
export interface ExaSearchOutcome {
    results: SearchResult[];
    status: ExaSearchStatus;
}
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
 * austlii.edu.au URLs, filtered to the requested document type and jurisdiction.
 */
export declare function searchAustliiViaExaWithStatus(query: string, options: SearchOptions, limit: number): Promise<ExaSearchOutcome>;
export declare function searchAustliiViaExa(query: string, options: SearchOptions, limit: number): Promise<SearchResult[]>;
//# sourceMappingURL=exa.d.ts.map