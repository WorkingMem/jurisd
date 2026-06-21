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
 * Returns true when `html` looks like a Cloudflare challenge page rather
 * than an AustLII document.
 *
 * The check is deliberately conservative: it requires at least **two**
 * independent markers so that documents that happen to mention a CF marker
 * in passing are not misidentified.
 *
 * @param html - Raw HTML string from an HTTP response body.
 */
export declare function isCloudflareChallengeHtml(html: string): boolean;
/**
 * Returns true when Cloudflare marks a response as a challenge via the
 * documented `cf-mitigated: challenge` response header. This is CF's own
 * stable signal and is more reliable than HTML-body fingerprinting.
 */
export declare function isCloudflareChallengeHeader(headers: Record<string, string> | undefined): boolean;
/**
 * Returns true when an HTTP status code indicates a Cloudflare block.
 * CF typically returns 403 for the managed-challenge redirect and 503
 * for the "bot fight mode" hard block.
 */
export declare function isCloudflareBotBlock(statusCode: number): boolean;
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
export declare function isCloudflareChallenge(status: number, body: string, headers?: Record<string, string>): boolean;
/**
 * Returns a user-facing message describing a Cloudflare block, suitable
 * for inclusion in a typed error.
 *
 * AustLII now serves a JS managed-challenge that TLS impersonation cannot
 * clear, so the remedy is a configured fallback source, not a transport tweak.
 */
export declare function cfBlockMessage(url: string): string;
//# sourceMappingURL=cloudflare.d.ts.map