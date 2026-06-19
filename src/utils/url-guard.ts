const ALLOWED_HOSTS = new Set([
  "www.austlii.edu.au",
  "classic.austlii.edu.au",
  "austlii.edu.au",
  "removed.invalid",
  "removed.invalid",
]);

/**
 * Asserts that a URL is safe to fetch from.
 * Blocks SSRF vectors: non-HTTPS protocols, private/localhost hosts,
 * and hosts not in the explicit allowlist.
 *
 * @throws {Error} If the URL is not permitted
 */
export function assertFetchableUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`Only HTTPS permitted. Got: ${parsed.protocol}`);
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `Host '${parsed.hostname}' not in permitted list: ${[...ALLOWED_HOSTS].join(", ")}`,
    );
  }
}

/**
 * Maximum redirects to follow on guarded fetches. `assertFetchableUrl` only
 * validates the first hop; without a bound + per-hop re-check, a 302 from an
 * allowlisted origin to an internal address (or a metadata endpoint) would be
 * followed silently. Keep this small — legitimate AustLII/source flows redirect
 * at most once or twice.
 */
export const MAX_REDIRECTS = 3;

/** The subset of axios' `beforeRedirect` options we read to rebuild the next-hop URL. */
interface RedirectOptions {
  protocol?: string;
  host?: string;
  hostname?: string;
  path?: string;
  href?: string;
  headers?: Record<string, unknown>;
}

const SENSITIVE_REDIRECT_HEADERS = new Set(["authorization", "cookie", "proxy-authorization"]);

function stripSensitiveRedirectHeaders(headers: Record<string, unknown> | undefined): void {
  if (!headers) return;
  for (const key of Object.keys(headers)) {
    if (SENSITIVE_REDIRECT_HEADERS.has(key.toLowerCase())) {
      delete headers[key];
    }
  }
}

/**
 * axios `beforeRedirect` hook: re-validate every redirect hop against the
 * allowlist so a redirect cannot escape to an internal/disallowed host
 * (SSRF / DNS-rebind hardening).
 *
 * @throws {Error} If the redirect target is not a permitted URL.
 */
export function assertRedirectAllowed(options: RedirectOptions): void {
  const href =
    options.href ??
    `${options.protocol ?? "https:"}//${options.host ?? options.hostname ?? ""}${options.path ?? ""}`;
  assertFetchableUrl(href);
  stripSensitiveRedirectHeaders(options.headers);
}
