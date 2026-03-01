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
    throw new Error(`Host '${parsed.hostname}' not in permitted list: ${[...ALLOWED_HOSTS].join(", ")}`);
  }
}
