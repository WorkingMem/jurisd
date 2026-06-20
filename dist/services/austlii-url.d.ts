/**
 * AustLII URL normalisation and rewriting.
 *
 * AustLII serves the same content on two hostnames:
 *   - classic.austlii.edu.au  (older; CF-walled as of 2026-06)
 *   - www.austlii.edu.au      (preferred; also CF-walled)
 *
 * The canonical form used internally is www.austlii.edu.au.
 * Callers that need to try the classic hostname (e.g. the impit transport
 * which clears CF on both) can use toClassicUrl().
 */
/** Canonical AustLII hostname (www). */
export declare const AUSTLII_WWW_HOST = "www.austlii.edu.au";
/** Classic AustLII hostname. */
export declare const AUSTLII_CLASSIC_HOST = "classic.austlii.edu.au";
/**
 * Returns true when the supplied URL is hosted on any AustLII origin
 * (www or classic).
 */
export declare function isAustliiUrl(url: string): boolean;
/**
 * Rewrites an AustLII URL so it points at the www (canonical) hostname.
 * Non-AustLII URLs are returned unchanged.
 *
 * @example
 * toWwwUrl("https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html")
 * // => "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html"
 */
export declare function toWwwUrl(url: string): string;
/**
 * Rewrites an AustLII URL so it points at the classic hostname.
 * Non-AustLII URLs are returned unchanged.
 *
 * @example
 * toClassicUrl("https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html")
 * // => "https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html"
 */
export declare function toClassicUrl(url: string): string;
/**
 * Normalises an AustLII document path into a canonical www URL.
 * Accepts either a full URL or an absolute path (no scheme/host).
 *
 * @example
 * normaliseAustliiPath("/au/cases/cth/HCA/1992/23.html")
 * // => "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html"
 *
 * normaliseAustliiPath("https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html")
 * // => "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html"
 */
export declare function normaliseAustliiPath(urlOrPath: string): string;
/**
 * Rewrites an AustLII URL to the classic hostname **and** the direct document
 * path used by the underlying document store. The classic host serves the same
 * documents via a `/cgi-bin/viewdoc/<path>` viewer wrapper as well as the raw
 * `<path>` form; this strips the viewer prefix so the impit transport fetches
 * the document body directly.
 *
 * Non-AustLII URLs and unparseable input are returned unchanged.
 *
 * @example
 * toClassicDocUrl("https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html")
 * // => "https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html"
 */
export declare function toClassicDocUrl(url: string): string;
/**
 * Derives the neutral citation token from an AustLII case URL, e.g.
 * `/au/cases/cth/HCA/1992/23.html` → `"[1992] HCA 23"`. This is the only stable
 * join key from an AustLII URL into the OALC corpus (whose `url` field holds the
 * primary-source slug, not the AustLII path).
 *
 * Returns null for legislation URLs, non-case paths, or unparseable input.
 * Inverse of `austliiUrlFromNeutral` in index.ts.
 */
export declare function austliiUrlToNeutralCitation(url: string): string | null;
/**
 * Returns true when an AustLII URL points at legislation rather than case law
 * (its path contains a `/legis/` segment). Used to tune the OALC `type` filter.
 */
export declare function austliiUrlIsLegislation(url: string): boolean;
//# sourceMappingURL=austlii-url.d.ts.map