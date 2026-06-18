const ALLOWED_HOSTS = new Set([
    "www.austlii.edu.au",
    "classic.austlii.edu.au",
    "austlii.edu.au",
    "jade.io",
    "www.jade.io",
]);
/**
 * Asserts that a URL is safe to fetch from.
 * Blocks SSRF vectors: non-HTTPS protocols, private/localhost hosts,
 * and hosts not in the explicit allowlist.
 *
 * @throws {Error} If the URL is not permitted
 */
export function assertFetchableUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        throw new Error(`Invalid URL: ${url}`);
    }
    if (parsed.protocol !== "https:") {
        throw new Error(`Only HTTPS permitted. Got: ${parsed.protocol}`);
    }
    if (!ALLOWED_HOSTS.has(parsed.hostname)) {
        throw new Error(`Host '${parsed.hostname}' not in permitted list: ${[...ALLOWED_HOSTS].join(", ")}`);
    }
}
/**
 * Maximum redirects to follow on guarded fetches. `assertFetchableUrl` only
 * validates the first hop; without a bound + per-hop re-check, a 302 from an
 * allowlisted origin to an internal address (or a metadata endpoint) would be
 * followed silently. Keep this small — legitimate AustLII/jade flows redirect
 * at most once or twice.
 */
export const MAX_REDIRECTS = 3;
/**
 * axios `beforeRedirect` hook: re-validate every redirect hop against the
 * allowlist so a redirect cannot escape to an internal/disallowed host
 * (SSRF / DNS-rebind hardening).
 *
 * @throws {Error} If the redirect target is not a permitted URL.
 */
export function assertRedirectAllowed(options) {
    const href = options.href ??
        `${options.protocol ?? "https:"}//${options.host ?? options.hostname ?? ""}${options.path ?? ""}`;
    assertFetchableUrl(href);
}
//# sourceMappingURL=url-guard.js.map