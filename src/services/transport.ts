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

import { config } from "../config.js";
import { HttpStatusError } from "../errors.js";
import { isCloudflareChallenge, cfBlockMessage } from "./cloudflare.js";
import { isAustliiUrl } from "./austlii-url.js";
import { assertFetchableUrl, assertRedirectAllowed, MAX_REDIRECTS } from "../utils/url-guard.js";

function isSuccessfulStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function shouldRewriteRedirectToGet(status: number, method: string): boolean {
  if (status === 303) {
    return method !== "HEAD";
  }
  return (status === 301 || status === 302) && method === "POST";
}

const SENSITIVE_REDIRECT_HEADERS = new Set(["authorization", "cookie", "proxy-authorization"]);

function sameOrigin(a: string, b: string): boolean {
  const first = new URL(a);
  const second = new URL(b);
  return (
    first.protocol === second.protocol &&
    first.hostname === second.hostname &&
    first.port === second.port
  );
}

function headersToRecord(
  headers: import("impit").RequestInit["headers"],
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }
  if (headers instanceof Headers) {
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key, value]));
  }
  return { ...headers };
}

function headersForImpitRedirect(
  headers: Record<string, string> | undefined,
  currentUrl: string,
  nextUrl: string,
): Record<string, string> | undefined {
  if (!headers || sameOrigin(currentUrl, nextUrl)) {
    return headers;
  }

  const nextHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!SENSITIVE_REDIRECT_HEADERS.has(key.toLowerCase())) {
      nextHeaders[key] = value;
    }
  }
  return nextHeaders;
}

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
 * Lazily attempt to import impit. Returns the module or null when a damaged or
 * stripped install is missing it. Errors other than MODULE_NOT_FOUND are
 * re-thrown.
 */
function isMissingImpitError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  const code = "code" in err ? (err as NodeJS.ErrnoException).code : undefined;
  return (
    code === "ERR_MODULE_NOT_FOUND" ||
    code === "MODULE_NOT_FOUND" ||
    err.message.includes("impit couldn't load native bindings") ||
    err.message.includes("skipped installation of optional dependencies")
  );
}

async function tryLoadImpit(): Promise<typeof import("impit") | null> {
  try {
    return await import("impit");
  } catch (err: unknown) {
    if (isMissingImpitError(err)) {
      return null;
    }
    throw err;
  }
}

async function fetchWithGuardedImpitRedirects(
  client: import("impit").Impit,
  url: string,
  init: import("impit").RequestInit,
): Promise<{ response: import("impit").ImpitResponse; finalUrl: string }> {
  let currentUrl = url;
  let method = (init.method ?? "GET").toUpperCase() as import("impit").HttpMethod;
  let body = init.body;
  let headers = headersToRecord(init.headers);

  for (let redirectCount = 0; ; redirectCount++) {
    const response = await client.fetch(currentUrl, {
      ...init,
      headers,
      method,
      body: method === "GET" ? undefined : body,
      redirect: "manual",
    });

    if (!isRedirectStatus(response.status)) {
      return { response, finalUrl: response.url || currentUrl };
    }

    const location = response.headers.get("location");
    if (!location) {
      return { response, finalUrl: response.url || currentUrl };
    }
    if (redirectCount >= MAX_REDIRECTS) {
      throw new Error(`Maximum redirect limit (${MAX_REDIRECTS}) exceeded`);
    }

    const nextUrl = new URL(location, currentUrl).toString();
    assertFetchableUrl(nextUrl);
    headers = headersForImpitRedirect(headers, currentUrl, nextUrl);
    currentUrl = nextUrl;
    if (shouldRewriteRedirectToGet(response.status, method)) {
      method = "GET";
      body = undefined;
    }
  }
}

/**
 * Fetches a URL using impit (TLS impersonation).
 * Throws a descriptive error when impit is not installed.
 */
async function fetchWithImpit(url: string, options: TransportOptions): Promise<TransportResponse> {
  const mod = await tryLoadImpit();
  if (!mod) {
    throw new Error(
      "impit is not installed. Run: npm install impit\n" +
        "impit is required to bypass Cloudflare TLS fingerprinting on AustLII.",
    );
  }

  const browser = (config.transport.imitBrowser as import("impit").Browser) ?? "chrome";
  const client = new mod.Impit({ browser, maxRedirects: MAX_REDIRECTS });

  const method = (options.method ?? "GET").toUpperCase() as import("impit").HttpMethod;

  const { response } = await fetchWithGuardedImpitRedirects(client, url, {
    method,
    headers: options.headers,
    timeout: options.timeout,
  });

  const body = await response.text();
  const status = response.status;

  const respHeaders: Record<string, string> = {};
  response.headers.forEach((value: string, key: string) => {
    respHeaders[key] = value;
  });

  if (isCloudflareChallenge(status, body, respHeaders)) {
    throw new Error(`[impit] ${cfBlockMessage(url)}`);
  }
  if (!isSuccessfulStatus(status)) {
    throw new HttpStatusError(url, status);
  }

  return { body, status, headers: respHeaders, via: "impit" };
}

/**
 * Fetches a URL using axios (plain HTTP, no TLS impersonation).
 */
async function fetchWithAxios(url: string, options: TransportOptions): Promise<TransportResponse> {
  const { default: axios } = await import("axios");
  const method = (options.method ?? "GET").toLowerCase();
  const timeout = options.timeout ?? 60_000;

  const response = await axios.request<string>({
    url,
    method,
    headers: options.headers ?? {},
    timeout,
    responseType: "text",
    validateStatus: () => true,
    maxRedirects: MAX_REDIRECTS,
    beforeRedirect: assertRedirectAllowed,
  });

  const body = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
  const status = response.status;

  const respHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(response.headers)) {
    if (typeof v === "string") {
      respHeaders[k] = v;
    }
  }

  if (isCloudflareChallenge(status, body, respHeaders)) {
    throw new Error(`[axios] ${cfBlockMessage(url)}`);
  }
  if (!isSuccessfulStatus(status)) {
    throw new HttpStatusError(url, status);
  }

  return { body, status, headers: respHeaders, via: "axios" };
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
export async function fetchWithTransport(
  url: string,
  options: TransportOptions = {},
): Promise<TransportResponse> {
  const shouldUseImpit = options.useImpit ?? config.transport.useImpit;

  if (!shouldUseImpit) {
    return fetchWithAxios(url, options);
  }

  const mod = await tryLoadImpit();
  if (!mod) {
    console.warn(
      "[transport] impit not installed — falling back to axios for " +
        url +
        ". Install impit to enable CF bypass: npm install impit",
    );
    return fetchWithAxios(url, options);
  }

  return fetchWithImpit(url, options);
}

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

class ImpitFetcher implements HttpFetcher {
  constructor(private readonly fallbackToAxios: boolean) {}

  async get(url: string, opts: FetcherOptions): Promise<FetcherResult> {
    const mod = await tryLoadImpit();
    if (!mod) {
      if (this.fallbackToAxios) {
        console.warn(
          "[transport] impit not installed or native bindings unavailable; falling back to axios for " +
            url,
        );
        return new AxiosFetcher().get(url, opts);
      }
      throw new Error(
        "impit is not installed. Run: npm install impit\n" +
          "impit is required to bypass Cloudflare TLS fingerprinting on AustLII.",
      );
    }
    const browser = (config.transport.imitBrowser as import("impit").Browser) ?? "chrome";
    const client = new mod.Impit({ browser, maxRedirects: MAX_REDIRECTS });
    const { response, finalUrl } = await fetchWithGuardedImpitRedirects(client, url, {
      method: "GET",
      headers: opts.headers,
      timeout: opts.timeoutMs,
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value: string, key: string) => {
      headers[key] = value;
    });
    const body = Buffer.from(await response.bytes());
    return { status: response.status, headers, body, finalUrl, via: "impit" };
  }
}

class AxiosFetcher implements HttpFetcher {
  async get(url: string, opts: FetcherOptions): Promise<FetcherResult> {
    const { default: axios } = await import("axios");
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: "arraybuffer",
      headers: opts.headers,
      timeout: opts.timeoutMs,
      validateStatus: () => true,
      maxRedirects: MAX_REDIRECTS,
      beforeRedirect: assertRedirectAllowed,
    });
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(response.headers)) {
      if (typeof v === "string") {
        headers[k] = v;
      }
    }
    const body = Buffer.from(response.data);
    const request = response.request as { res?: { responseUrl?: string } } | undefined;
    const finalUrl = request?.res?.responseUrl ?? url;
    return { status: response.status, headers, body, finalUrl, via: "axios" };
  }
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
export function fetcherForUrl(
  url: string,
  transport: "auto" | "impit" | "axios" = "auto",
): HttpFetcher {
  if (transport === "axios") {
    return new AxiosFetcher();
  }
  if (transport === "impit") {
    return new ImpitFetcher(false);
  }
  // auto: impit for AustLII unless globally disabled, axios otherwise.
  return isAustliiUrl(url) && config.transport.useImpit
    ? new ImpitFetcher(true)
    : new AxiosFetcher();
}
