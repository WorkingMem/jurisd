/**
 * Asserts that a URL is safe to fetch from.
 * Blocks SSRF vectors: non-HTTPS protocols, private/localhost hosts,
 * and hosts not in the explicit allowlist.
 *
 * @throws {Error} If the URL is not permitted
 */
export declare function assertFetchableUrl(url: string): void;
/**
 * Maximum redirects to follow on guarded fetches. `assertFetchableUrl` only
 * validates the first hop; without a bound + per-hop re-check, a 302 from an
 * allowlisted origin to an internal address (or a metadata endpoint) would be
 * followed silently. Keep this small — legitimate AustLII/source flows redirect
 * at most once or twice.
 */
export declare const MAX_REDIRECTS = 3;
/** The subset of axios' `beforeRedirect` options we read to rebuild the next-hop URL. */
interface RedirectOptions {
    protocol?: string;
    host?: string;
    hostname?: string;
    path?: string;
    href?: string;
    headers?: Record<string, unknown>;
}
/**
 * axios `beforeRedirect` hook: re-validate every redirect hop against the
 * allowlist so a redirect cannot escape to an internal/disallowed host
 * (SSRF / DNS-rebind hardening).
 *
 * @throws {Error} If the redirect target is not a permitted URL.
 */
export declare function assertRedirectAllowed(options: RedirectOptions): void;
export {};
//# sourceMappingURL=url-guard.d.ts.map