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
export const AUSTLII_WWW_HOST = "www.austlii.edu.au";

/** Classic AustLII hostname. */
export const AUSTLII_CLASSIC_HOST = "classic.austlii.edu.au";

/**
 * Returns true when the supplied URL is hosted on any AustLII origin
 * (www or classic).
 */
export function isAustliiUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === AUSTLII_WWW_HOST || hostname === AUSTLII_CLASSIC_HOST;
  } catch {
    return false;
  }
}

/**
 * Rewrites an AustLII URL so it points at the www (canonical) hostname.
 * Non-AustLII URLs are returned unchanged.
 *
 * @example
 * toWwwUrl("https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html")
 * // => "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html"
 */
export function toWwwUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === AUSTLII_CLASSIC_HOST) {
      parsed.hostname = AUSTLII_WWW_HOST;
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

/**
 * Rewrites an AustLII URL so it points at the classic hostname.
 * Non-AustLII URLs are returned unchanged.
 *
 * @example
 * toClassicUrl("https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html")
 * // => "https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html"
 */
export function toClassicUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === AUSTLII_WWW_HOST) {
      parsed.hostname = AUSTLII_CLASSIC_HOST;
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

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
export function normaliseAustliiPath(urlOrPath: string): string {
  if (urlOrPath.startsWith("/")) {
    return `https://${AUSTLII_WWW_HOST}${urlOrPath}`;
  }
  return toWwwUrl(urlOrPath);
}
