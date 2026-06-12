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

import { COURT_TO_AUSTLII_PATH } from "../constants.js";

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
export function toClassicDocUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== AUSTLII_WWW_HOST && parsed.hostname !== AUSTLII_CLASSIC_HOST) {
      return url;
    }
    parsed.hostname = AUSTLII_CLASSIC_HOST;
    parsed.pathname = parsed.pathname.replace(/^\/cgi-bin\/viewdoc\//, "/");
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Derives the neutral citation token from an AustLII case URL, e.g.
 * `/au/cases/cth/HCA/1992/23.html` → `"[1992] HCA 23"`. This is the only stable
 * join key from an AustLII URL into the OALC corpus (whose `url` field holds the
 * primary-source slug, not the AustLII path).
 *
 * Returns null for legislation URLs, non-case paths, or unparseable input.
 * Inverse of `austliiUrlFromNeutral` in index.ts.
 */
export function austliiUrlToNeutralCitation(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  // /(au|nz)/cases/<...>/<COURT>/<year>/<num>(.html)
  const m = pathname.match(/\/(?:au|nz)\/cases\/(?:[^/]+\/)*([A-Za-z0-9]+)\/(\d{4})\/(\d+)/);
  if (!m) return null;
  const [, court, year, num] = m;
  // Only accept courts we know how to map (guards against false positives such
  // as legislation paths that happen to contain numeric segments).
  if (!(court! in COURT_TO_AUSTLII_PATH)) return null;
  return `[${year}] ${court} ${num}`;
}

/**
 * Returns true when an AustLII URL points at legislation rather than case law
 * (its path contains a `/legis/` segment). Used to tune the OALC `type` filter.
 */
export function austliiUrlIsLegislation(url: string): boolean {
  try {
    return new URL(url).pathname.includes("/legis/");
  } catch {
    return false;
  }
}
