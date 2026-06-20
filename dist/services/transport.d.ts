/**
 * HTTP transport seam with impit TLS-impersonation support.
 *
 * AustLII (classic and www) sits behind Cloudflare Bot Management. Plain
 * axios/curl GET requests receive a CF managed-challenge page (HTTP 403 or
 * a 200 with JS-challenge body) rather than the document. The `impit`
 * library uses BoringSSL to mimic a real browser's TLS ClientHello
 * fingerprint, clearing the CF layer transparently.
 *
 * This module provides a single {@link fetchWithTransport} function that:
 *   1. Tries impit when it is installed and configured.
 *   2. Falls back to axios when impit is absent or disabled.
 *   3. Detects CF challenge responses and rethrows as a descriptive error.
 *
 * The lazy dynamic import means the dependency is never required at module load
 * time, so the server can still start and report clear transport errors if a
 * damaged install is missing it.
 */
export interface TransportResponse {
    body: string;
    status: number;
    headers: Record<string, string>;
    /** Which transport produced this response. */
    via: "impit" | "axios";
}
export interface TransportOptions {
    /** HTTP method. Defaults to "GET". */
    method?: string;
    headers?: Record<string, string>;
    /** Request timeout in milliseconds. */
    timeout?: number;
    /** Override the useImpit config setting for this request. */
    useImpit?: boolean;
}
/**
 * Fetch a URL using the configured transport (impit or axios).
 *
 * When `useImpit` is true (the default) and impit is installed, impit is
 * used. If impit is not installed, the function logs a warning and falls
 * back to axios. When `useImpit` is false, axios is used directly.
 *
 * Both paths detect Cloudflare challenge responses and throw a typed error
 * rather than returning garbage HTML.
 */
export declare function fetchWithTransport(url: string, options?: TransportOptions): Promise<TransportResponse>;
/**
 * Raw byte-level fetch result. Unlike {@link TransportResponse}, the body is a
 * Buffer (so PDF/binary documents survive intact) and Cloudflare-challenge
 * responses are **not** thrown — the caller inspects {@link FetcherResult.body}
 * and {@link FetcherResult.status} itself so it can route to the OALC fallback.
 */
export interface FetcherResult {
    status: number;
    headers: Record<string, string>;
    body: Buffer;
    finalUrl: string;
    via: "impit" | "axios";
}
/** Per-request options for {@link HttpFetcher.get}. */
export interface FetcherOptions {
    headers: Record<string, string>;
    timeoutMs: number;
}
/** A host-routed HTTP fetcher returning raw bytes. */
export interface HttpFetcher {
    get(url: string, opts: FetcherOptions): Promise<FetcherResult>;
}
/**
 * Selects the byte-level fetcher for a URL.
 *
 * In auto mode, AustLII URLs use {@link ImpitFetcher} only when
 * `AUSLAW_USE_IMPIT` has not disabled it; non-AustLII URLs use
 * {@link AxiosFetcher}. When the transport mode is `"impit"`, impit is forced
 * even for non-AustLII URLs.
 *
 * @param url - The target URL.
 * @param transport - The configured AustLII transport mode ("auto"|"impit"|"axios").
 */
export declare function fetcherForUrl(url: string, transport?: "auto" | "impit" | "axios"): HttpFetcher;
//# sourceMappingURL=transport.d.ts.map