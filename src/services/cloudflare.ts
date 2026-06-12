/**
 * Cloudflare challenge detection for AustLII responses.
 *
 * AustLII (both www and classic hostnames) sits behind Cloudflare.
 * Unauthenticated curl/axios GET requests receive a "managed challenge"
 * page (HTTP 403 or 200 with JS challenge body) instead of the document.
 *
 * This module provides a single predicate that detects the challenge so
 * callers can route to the impit transport or surface a typed error.
 */

/**
 * A non-exhaustive list of strings that appear in Cloudflare challenge pages.
 * The fingerprint uses multiple anchors to stay robust across CF template
 * versions.
 */
const CF_CHALLENGE_MARKERS: ReadonlyArray<string> = [
  // Title injected by CF managed-challenge template
  "Just a moment...",
  // Turned-off-JS fallback text
  "Enable JavaScript and cookies to continue",
  // CF challenge platform script path
  "/cdn-cgi/challenge-platform/",
  // The `_cf_chl_opt` JS object set by every CF challenge variant
  "window._cf_chl_opt",
];

/**
 * Returns true when `html` looks like a Cloudflare challenge page rather
 * than an AustLII document.
 *
 * The check is deliberately conservative: it requires at least **two**
 * independent markers so that documents that happen to mention a CF marker
 * in passing are not misidentified.
 *
 * @param html - Raw HTML string from an HTTP response body.
 */
export function isCloudflareChallengeHtml(html: string): boolean {
  let matchCount = 0;
  for (const marker of CF_CHALLENGE_MARKERS) {
    if (html.includes(marker)) {
      matchCount++;
      if (matchCount >= 2) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Returns true when an HTTP status code indicates a Cloudflare block.
 * CF typically returns 403 for the managed-challenge redirect and 503
 * for the "bot fight mode" hard block.
 */
export function isCloudflareBotBlock(statusCode: number): boolean {
  return statusCode === 403 || statusCode === 503;
}

/**
 * Returns a user-facing message describing a Cloudflare block, suitable
 * for inclusion in a typed error.
 */
export function cfBlockMessage(url: string): string {
  return (
    `AustLII returned a Cloudflare challenge for ${url}. ` +
    "Install the optional 'impit' dependency to bypass TLS fingerprinting: " +
    "npm install impit"
  );
}
