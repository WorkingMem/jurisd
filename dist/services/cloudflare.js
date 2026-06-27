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
const CF_CHALLENGE_MARKERS = [
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
export function isCloudflareChallengeHtml(html) {
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
 * Returns true when Cloudflare marks a response as a challenge via the
 * documented `cf-mitigated: challenge` response header. This is CF's own
 * stable signal and is more reliable than HTML-body fingerprinting.
 */
export function isCloudflareChallengeHeader(headers) {
    if (!headers)
        return false;
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === "cf-mitigated" && value.toLowerCase().includes("challenge")) {
            return true;
        }
    }
    return false;
}
/**
 * Returns true when an HTTP status code indicates a Cloudflare block.
 * CF typically returns 403 for the managed-challenge redirect and 503
 * for the "bot fight mode" hard block.
 */
export function isCloudflareBotBlock(statusCode) {
    return statusCode === 403 || statusCode === 503;
}
/**
 * Returns true when an HTTP response (status + body) is a Cloudflare challenge
 * rather than a real document.
 *
 * A response is treated as a challenge when any of these hold:
 *   - Cloudflare sets the documented `cf-mitigated: challenge` response header;
 *   - the body matches the challenge-page fingerprint (≥2 markers), regardless
 *     of status (CF sometimes serves the JS challenge with HTTP 200); or
 *   - the status is a CF bot-block code (403/503) **and** the body also looks
 *     like a challenge page — a bare 403 with a real error body is left alone
 *     so legitimate not-authorised responses are not misclassified.
 *
 * @param status - HTTP status code.
 * @param body - Response body decoded as a UTF-8 string.
 * @param headers - Response headers, used for Cloudflare's documented marker.
 */
export function isCloudflareChallenge(status, body, headers) {
    if (isCloudflareChallengeHeader(headers)) {
        return true;
    }
    if (isCloudflareChallengeHtml(body)) {
        return true;
    }
    return isCloudflareBotBlock(status) && isCloudflareChallengeHtml(body);
}
/**
 * Returns a user-facing message describing a Cloudflare block, suitable
 * for inclusion in a typed error.
 *
 * AustLII now serves a JS managed-challenge that TLS impersonation cannot
 * clear, so the remedy is a configured fallback source, not a transport tweak.
 */
export function cfBlockMessage(url) {
    return (`AustLII is behind a Cloudflare challenge and cannot be fetched directly (${url}). ` +
        "Configure a fallback source: set EXA_API_KEY (search discovery).");
}
//# sourceMappingURL=cloudflare.js.map