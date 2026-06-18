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
import { isAustliiUrl } from "./austlii-url.js";
import { assertFetchableUrl, assertRedirectAllowed, MAX_REDIRECTS } from "../utils/url-guard.js";
/**
 * impit follows redirects internally (bounded by {@link MAX_REDIRECTS}), so we
 * cannot re-check each hop the way axios' `beforeRedirect` does. Instead, after
 * the fetch, reject when the chain changed host to one that is not itself
 * allowlisted — this blocks an allowlisted origin from bouncing us to an
 * internal/metadata address (SSRF) while still permitting same-host redirects
 * and AustLII's www<->classic hops. A same-host (or no) redirect is always fine.
 */
function assertNoUnsafeImpitRedirect(initialUrl, finalUrl) {
    if (!finalUrl)
        return;
    let init;
    let fin;
    try {
        init = new URL(initialUrl);
        fin = new URL(finalUrl);
    }
    catch {
        return;
    }
    if (fin.hostname === init.hostname)
        return;
    assertFetchableUrl(finalUrl);
}
/**
 * Lazily attempt to import impit. Returns the module or null when not
 * installed. Errors other than MODULE_NOT_FOUND are re-thrown.
 */
async function tryLoadImpit() {
    try {
        return await import("impit");
    }
    catch (err) {
        if (err instanceof Error &&
            "code" in err &&
            err.code === "ERR_MODULE_NOT_FOUND") {
            return null;
        }
        throw err;
    }
}
/**
 * Fetches a URL using impit (TLS impersonation).
 * Throws a descriptive error when impit is not installed.
 */
async function fetchWithImpit(url, options) {
    const mod = await tryLoadImpit();
    if (!mod) {
        throw new Error("impit is not installed. Run: npm install impit\n" +
            "impit is required to bypass Cloudflare TLS fingerprinting on AustLII.");
    }
    const browser = config.transport.imitBrowser ?? "chrome";
    const client = new mod.Impit({ browser, maxRedirects: MAX_REDIRECTS });
    const method = (options.method ?? "GET").toUpperCase();
    const headers = options.headers ?? {};
    const response = await client.fetch(url, { method, headers });
    assertNoUnsafeImpitRedirect(url, response.url);
    const body = await response.text();
    const status = response.status;
    const respHeaders = {};
    response.headers.forEach((value, key) => {
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
async function fetchWithAxios(url, options) {
    const { default: axios } = await import("axios");
    const method = (options.method ?? "GET").toLowerCase();
    const timeout = options.timeout ?? 60_000;
    const response = await axios.request({
        url,
        method,
        headers: options.headers ?? {},
        timeout,
        responseType: "text",
        maxRedirects: MAX_REDIRECTS,
        beforeRedirect: assertRedirectAllowed,
    });
    const body = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
    const status = response.status;
    const respHeaders = {};
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
export async function fetchWithTransport(url, options = {}) {
    const shouldUseImpit = options.useImpit ?? config.transport.useImpit;
    if (!shouldUseImpit) {
        return fetchWithAxios(url, options);
    }
    const mod = await tryLoadImpit();
    if (!mod) {
        console.warn("[transport] impit not installed — falling back to axios for " +
            url +
            ". Install impit to enable CF bypass: npm install impit");
        return fetchWithAxios(url, options);
    }
    return fetchWithImpit(url, options);
}
class ImpitFetcher {
    async get(url, opts) {
        const mod = await tryLoadImpit();
        if (!mod) {
            throw new Error("impit is not installed. Run: npm install impit\n" +
                "impit is required to bypass Cloudflare TLS fingerprinting on AustLII.");
        }
        const browser = config.transport.imitBrowser ?? "chrome";
        const client = new mod.Impit({ browser, maxRedirects: MAX_REDIRECTS });
        const response = await client.fetch(url, {
            method: "GET",
            headers: opts.headers,
        });
        // impit follows redirects internally; reject before consuming the body if
        // the chain bounced cross-host to a disallowed address (SSRF hardening).
        const finalUrl = response.url || url;
        assertNoUnsafeImpitRedirect(url, response.url);
        const headers = {};
        response.headers.forEach((value, key) => {
            headers[key] = value;
        });
        const body = Buffer.from(await response.bytes());
        return { status: response.status, headers, body, finalUrl, via: "impit" };
    }
}
class AxiosFetcher {
    async get(url, opts) {
        const { default: axios } = await import("axios");
        const response = await axios.get(url, {
            responseType: "arraybuffer",
            headers: opts.headers,
            timeout: opts.timeoutMs,
            maxRedirects: MAX_REDIRECTS,
            beforeRedirect: assertRedirectAllowed,
        });
        const headers = {};
        for (const [k, v] of Object.entries(response.headers)) {
            if (typeof v === "string") {
                headers[k] = v;
            }
        }
        const body = Buffer.from(response.data);
        return { status: response.status, headers, body, finalUrl: url, via: "axios" };
    }
}
/**
 * Selects the byte-level fetcher for a URL.
 *
 * AustLII URLs use {@link ImpitFetcher} (TLS impersonation) unless the caller
 * forces `"axios"`; non-AustLII URLs always use {@link AxiosFetcher}. When the
 * transport mode is `"impit"`, impit is forced even for non-AustLII URLs.
 *
 * @param url - The target URL.
 * @param transport - The configured AustLII transport mode ("auto"|"impit"|"axios").
 */
export function fetcherForUrl(url, transport = "auto") {
    if (transport === "axios") {
        return new AxiosFetcher();
    }
    if (transport === "impit") {
        return new ImpitFetcher();
    }
    // auto: impit for AustLII, axios otherwise.
    return isAustliiUrl(url) ? new ImpitFetcher() : new AxiosFetcher();
}
//# sourceMappingURL=transport.js.map