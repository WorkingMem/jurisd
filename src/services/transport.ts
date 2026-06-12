/**
 * HTTP transport seam with optional impit TLS-impersonation support.
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
 * The lazy dynamic import means the optional dep is never required at
 * module load time — the server starts cleanly without it.
 */

import { config } from "../config.js";
import { isCloudflareChallengeHtml, isCloudflareBotBlock, cfBlockMessage } from "./cloudflare.js";

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
 * Lazily attempt to import impit. Returns the module or null when not
 * installed. Errors other than MODULE_NOT_FOUND are re-thrown.
 */
async function tryLoadImpit(): Promise<typeof import("impit") | null> {
  try {
    return await import("impit");
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND"
    ) {
      return null;
    }
    throw err;
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
  const client = new mod.Impit({ browser });

  const method = (options.method ?? "GET").toUpperCase() as import("impit").HttpMethod;
  const headers = options.headers ?? {};

  const response = await client.fetch(url, { method, headers });

  const body = await response.text();
  const status = response.status;

  const respHeaders: Record<string, string> = {};
  response.headers.forEach((value: string, key: string) => {
    respHeaders[key] = value;
  });

  if (isCloudflareBotBlock(status) || isCloudflareChallengeHtml(body)) {
    throw new Error(`[impit] ${cfBlockMessage(url)}`);
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
  });

  const body = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
  const status = response.status;

  const respHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(response.headers)) {
    if (typeof v === "string") {
      respHeaders[k] = v;
    }
  }

  if (isCloudflareBotBlock(status) || isCloudflareChallengeHtml(body)) {
    throw new Error(`[axios] ${cfBlockMessage(url)}`);
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
