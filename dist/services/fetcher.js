import axios from "axios";
import * as cheerio from "cheerio";
import { fileTypeFromBuffer } from "file-type";
import { config } from "../config.js";
import { MAX_CONTENT_LENGTH } from "../constants.js";
import { isJadeUrl, extractArticleId, fetchJadeArticleContent } from "./jade.js";
import { assertFetchableUrl, assertRedirectAllowed, MAX_REDIRECTS } from "../utils/url-guard.js";
import { austliiRateLimiter, jadeRateLimiter } from "../utils/rate-limiter.js";
import { isAustliiUrl, toClassicDocUrl, toWwwUrl, austliiUrlToNeutralCitation, austliiUrlIsLegislation, } from "./austlii-url.js";
import { fetcherForUrl } from "./transport.js";
import { isCloudflareChallenge } from "./cloudflare.js";
import { lookupByCitation } from "./oalc.js";
import { CloudflareBlockedError, HttpStatusError } from "../errors.js";
async function extractTextFromPdf(buffer, url) {
    try {
        const { PDFParse } = await import("pdf-parse");
        // Extract the embedded text layer of the PDF via pdf-parse v2.
        const parser = new PDFParse({ data: new Uint8Array(buffer) });
        const textResult = await parser.getText();
        await parser.destroy();
        return textResult.text.trim();
    }
    catch (error) {
        console.warn(`PDF parsing failed for ${url}:`, error);
        return "";
    }
}
/**
 * Extracts text from jade.io HTML with special handling for their structure
 */
function extractTextFromJadeHtml(html) {
    const $ = cheerio.load(html);
    // Remove unwanted elements
    $("script, style, nav, header, footer, .sidebar, .navigation, .menu").remove();
    // jade.io specific selectors
    const jadeSelectors = [
        ".judgment-text",
        ".judgment-content",
        ".decision-text",
        "#judgment",
        ".case-content",
        "article.judgment",
    ];
    for (const selector of jadeSelectors) {
        const $content = $(selector);
        if ($content.length > 0) {
            const text = $content.text().trim();
            if (text.length > 200) {
                return text;
            }
        }
    }
    // Fall through to generic extraction
    return extractTextFromHtml(html);
}
/**
 * Generic HTML text extraction for AustLII and other sources
 */
function extractTextFromHtml(html, url) {
    const $ = cheerio.load(html);
    // Check if this is jade.io
    if (url) {
        try {
            const hostname = new URL(url).hostname.toLowerCase();
            if (hostname === "jade.io" || hostname.endsWith(".jade.io")) {
                return extractTextFromJadeHtml(html);
            }
        }
        catch {
            // If URL parsing fails, fall through to generic extraction.
        }
    }
    // Remove script and style elements
    $("script, style, nav, header, footer").remove();
    // Try to find the main content area
    // Common patterns in legal websites
    const mainContentSelectors = [
        "article",
        "main",
        ".content",
        "#content",
        ".judgment",
        ".decision",
        ".case",
        ".legislation",
        "[role='main']",
    ];
    for (const selector of mainContentSelectors) {
        const $main = $(selector);
        if ($main.length > 0) {
            const text = $main.text().trim();
            if (text.length > 200) {
                return text;
            }
        }
    }
    // Fallback: Extract from body
    const bodyText = $("body").text().trim();
    // Clean up whitespace
    return bodyText.replace(/\s+/g, " ").trim();
}
/**
 * Cleans HTML by removing scripts, styles, navigation and other non-content
 * elements while preserving the document structure (headings, paragraphs, etc).
 */
function cleanHtmlForOutput(html) {
    const $ = cheerio.load(html);
    // Remove non-content elements
    $("script, style, nav, header, footer, .sidebar, .navigation, .menu, link, meta").remove();
    // Try to extract just the main content area
    const contentSelectors = [
        "article",
        "main",
        ".content",
        "#content",
        ".judgment",
        ".judgment-text",
        ".judgment-content",
        ".decision",
        ".case-content",
        "[role='main']",
    ];
    for (const selector of contentSelectors) {
        const $content = $(selector);
        if ($content.length > 0) {
            const contentHtml = $content.html()?.trim();
            if (contentHtml && contentHtml.length > 200) {
                return contentHtml;
            }
        }
    }
    // Fallback: return the cleaned body
    const bodyHtml = $("body").html()?.trim();
    return bodyHtml || $.html() || "";
}
function extractParagraphBlocks(html) {
    const $ = cheerio.load(html);
    const paragraphs = [];
    $("p, div").each((_, el) => {
        const text = $(el).text().trim();
        const match = text.match(/^\[(\d+)\]\s*([\s\S]+)/);
        if (match && match[1] && match[2]) {
            paragraphs.push({
                number: parseInt(match[1], 10),
                text: match[2].trim(),
            });
        }
    });
    return paragraphs;
}
/**
 * Parses a fetched document body (Buffer + content-type) into a
 * {@link FetchResponse}, driving the PDF, HTML and plain-text paths off the
 * detected content type. Shared by the AustLII (impit) and generic (axios)
 * fetch paths so both parse identically.
 *
 * @param buffer - Raw response bytes.
 * @param rawContentType - The `content-type` response header (may be undefined).
 * @param url - The source URL (used for jade-specific HTML extraction + metadata).
 * @param extra - Optional `etag`/`lastModified`/`source` to fold into the result.
 */
async function parseDocumentBuffer(buffer, rawContentType, url, extra) {
    const contentType = typeof rawContentType === "string" ? rawContentType : "";
    // Detect file type from buffer
    const detectedType = await fileTypeFromBuffer(buffer);
    let text;
    let cleanedHtml;
    let paragraphs;
    // Handle PDF documents
    if (contentType.includes("application/pdf") || detectedType?.mime === "application/pdf") {
        text = await extractTextFromPdf(buffer, url);
    }
    // Handle HTML documents
    else if (contentType.includes("text/html") || detectedType?.mime === "text/html") {
        const rawHtml = buffer.toString("utf-8");
        text = extractTextFromHtml(rawHtml, url);
        paragraphs = extractParagraphBlocks(rawHtml);
        cleanedHtml = cleanHtmlForOutput(rawHtml);
    }
    // Handle plain text
    else if (contentType.includes("text/plain")) {
        text = buffer.toString("utf-8");
    }
    // Unsupported format
    else {
        throw new Error(`Unsupported content type: ${contentType}${detectedType ? ` (detected: ${detectedType.mime})` : ""}`);
    }
    const metadata = {
        contentLength: String(buffer.length),
        contentType: contentType || detectedType?.mime || "unknown",
    };
    if (extra?.source) {
        metadata.source = extra.source;
    }
    return {
        text,
        html: cleanedHtml,
        contentType: contentType || detectedType?.mime || "unknown",
        sourceUrl: url,
        metadata,
        paragraphs,
        etag: extra?.etag,
        lastModified: extra?.lastModified,
    };
}
function uniqueUrls(urls) {
    return Array.from(new Set(urls));
}
function austliiDocumentTargets(url) {
    const classicDoc = toClassicDocUrl(url);
    const wwwDoc = toWwwUrl(classicDoc);
    const targets = config.austlii.classicRewrite
        ? [classicDoc, wwwDoc, url]
        : [url, classicDoc, wwwDoc];
    return uniqueUrls(targets);
}
/**
 * Fetches an AustLII document through the impit TLS-impersonating transport,
 * detecting Cloudflare challenges and falling back to the local OALC corpus.
 *
 * Flow (per the C0 routing contract, live-AustLII layer + OALC fallback):
 *   1. Try the configured URL form, plus classic/www direct-document fallbacks.
 *   2. Build headers from config.austlii; attach cf_clearance cookie if set.
 *   3. Fetch via the host-routed fetcher (impit for AustLII).
 *   4. If the response is a Cloudflare challenge: when OALC is enabled, join on
 *      the neutral citation and return the corpus text (source='oalc-fallback');
 *      otherwise throw a typed {@link CloudflareBlockedError}.
 *   5. Otherwise parse the body exactly as the generic path does.
 */
async function fetchAustliiDocument(url) {
    const headers = {
        "User-Agent": config.austlii.userAgent,
        Accept: config.austlii.accept,
        "Accept-Language": config.austlii.acceptLanguage,
    };
    if (config.austlii.referer) {
        headers["Referer"] = config.austlii.referer;
    }
    if (config.austlii.cfClearance) {
        headers["Cookie"] = `cf_clearance=${config.austlii.cfClearance}`;
    }
    let sawCloudflareChallenge = false;
    let challengedUrl = url;
    let lastError;
    for (const target of austliiDocumentTargets(url)) {
        let r;
        try {
            await austliiRateLimiter.throttle();
            const fetcher = fetcherForUrl(target, config.austlii.transport);
            r = await fetcher.get(target, { headers, timeoutMs: config.austlii.timeout });
        }
        catch (error) {
            lastError = error;
            continue;
        }
        const bodyText = r.body.toString("utf-8");
        if (isCloudflareChallenge(r.status, bodyText, r.headers)) {
            sawCloudflareChallenge = true;
            challengedUrl = target;
            continue;
        }
        if (r.status < 200 || r.status >= 300) {
            lastError = new HttpStatusError(target, r.status);
            continue;
        }
        return parseDocumentBuffer(r.body, r.headers["content-type"], url, {
            etag: r.headers["etag"],
            lastModified: r.headers["last-modified"],
        });
    }
    if (sawCloudflareChallenge) {
        if (config.oalc.enabled) {
            const cite = austliiUrlToNeutralCitation(url);
            if (cite) {
                const isLegis = austliiUrlIsLegislation(url);
                const hit = await lookupByCitation(cite, isLegis);
                if (hit) {
                    return parseDocumentBuffer(Buffer.from(hit.text, "utf-8"), hit.mime, url, {
                        source: "oalc-fallback",
                    });
                }
            }
            throw new CloudflareBlockedError(challengedUrl, true);
        }
        throw new CloudflareBlockedError(challengedUrl, false);
    }
    throw lastError instanceof Error
        ? lastError
        : new Error(`Failed to fetch AustLII document: ${url}`);
}
/**
 * Fetches a legal document from a URL and extracts its text content.
 *
 * Supports HTML pages, PDF documents, and plain text.
 *
 * AustLII URLs are routed through the impit transport with Cloudflare-challenge
 * detection and an OALC corpus fallback; jade.io and all other URLs are
 * unchanged.
 *
 * @param url - Absolute URL of the document to fetch
 * @returns Promise resolving to a {@link FetchResponse} with extracted text
 * @throws {Error} If the network request fails or the content type is unsupported
 */
export async function fetchDocumentText(url) {
    assertFetchableUrl(url);
    // jade.io uses GWT-RPC — content is loaded client-side and not available
    // via a plain HTTP fetch. Route through the direct GWT-RPC API when a
    // session cookie is configured; reject with a helpful message otherwise.
    if (isJadeUrl(url)) {
        if (!config.jade.sessionCookie) {
            throw new Error("fetch_document_text requires JADE_SESSION_COOKIE for jade.io URLs. " +
                "jade.io renders content via a GWT single-page application. " +
                "Set JADE_SESSION_COOKIE in your environment (see README for extraction instructions).");
        }
        const articleId = extractArticleId(url);
        if (!articleId) {
            throw new Error(`Could not extract article ID from jade.io URL: ${url}`);
        }
        await jadeRateLimiter.throttle();
        let html;
        try {
            html = await fetchJadeArticleContent(articleId, config.jade.sessionCookie);
        }
        catch (error) {
            // Convert AxiosError to a plain Error so config.headers (which contains the
            // Cookie with JADE_SESSION_COOKIE) is never propagated to the caller or logger.
            if (axios.isAxiosError(error)) {
                const status = error.response?.status;
                if (status === 401 || status === 403) {
                    throw new Error(`jade.io returned ${status}. The JADE_SESSION_COOKIE may have expired — re-extract it from your browser session.`);
                }
                throw new Error(`Failed to fetch jade.io article ${articleId}: ${error.message}`);
            }
            throw error;
        }
        const text = extractTextFromHtml(html, url);
        const paragraphs = extractParagraphBlocks(html);
        const cleanedHtml = cleanHtmlForOutput(html);
        return {
            text,
            html: cleanedHtml,
            contentType: "text/html",
            sourceUrl: url,
            metadata: {
                contentLength: String(html.length),
                contentType: "text/html",
                source: "jade-gwt-rpc",
            },
            paragraphs,
        };
    }
    // AustLII: route through the impit TLS-impersonating transport with
    // Cloudflare-challenge detection and OALC corpus fallback.
    if (isAustliiUrl(url)) {
        return fetchAustliiDocument(url);
    }
    try {
        await austliiRateLimiter.throttle();
        const headers = {
            "User-Agent": config.jade.userAgent,
        };
        const response = await axios.get(url, {
            responseType: "arraybuffer",
            headers,
            timeout: config.jade.timeout,
            maxContentLength: MAX_CONTENT_LENGTH,
            maxRedirects: MAX_REDIRECTS,
            beforeRedirect: assertRedirectAllowed,
        });
        const buffer = Buffer.from(response.data);
        const rawContentType = response.headers["content-type"];
        return parseDocumentBuffer(buffer, typeof rawContentType === "string" ? rawContentType : undefined, url, {
            etag: response.headers["etag"] ?? undefined,
            lastModified: response.headers["last-modified"] ?? undefined,
        });
    }
    catch (error) {
        if (axios.isAxiosError(error)) {
            if (isJadeUrl(url) && (error.response?.status === 401 || error.response?.status === 403)) {
                throw new Error(`jade.io returned ${error.response.status}. Set JADE_SESSION_COOKIE env var with your authenticated session cookie.`);
            }
            throw new Error(`Failed to fetch document from ${url}: ${error.message}`);
        }
        throw error;
    }
}
//# sourceMappingURL=fetcher.js.map