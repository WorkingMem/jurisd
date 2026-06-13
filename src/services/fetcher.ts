import axios from "axios";
import * as cheerio from "cheerio";
import { fileTypeFromBuffer } from "file-type";
import { PDFParse } from "pdf-parse";
import { config } from "../config.js";
import { MAX_CONTENT_LENGTH } from "../constants.js";
import { isSourceUrl, extractArticleId, fetchSourceArticleContent } from "./source.js";
import { assertFetchableUrl } from "../utils/url-guard.js";
import { austliiRateLimiter, upstreamRateLimiter } from "../utils/rate-limiter.js";
import {
  isAustliiUrl,
  toClassicDocUrl,
  austliiUrlToNeutralCitation,
  austliiUrlIsLegislation,
} from "./austlii-url.js";
import { fetcherForUrl } from "./transport.js";
import { isCloudflareChallenge } from "./cloudflare.js";
import { lookupByCitation } from "./oalc.js";
import { CloudflareBlockedError } from "../errors.js";

export interface ParagraphBlock {
  number: number;
  text: string;
  pageNumber?: number;
}

export interface FetchResponse {
  text: string;
  /** Cleaned HTML preserving document structure (only set for HTML sources). */
  html?: string;
  contentType: string;
  sourceUrl: string;
  metadata?: Record<string, string>;
  paragraphs?: ParagraphBlock[];
  etag?: string;
  lastModified?: string;
}

async function extractTextFromPdf(buffer: Buffer, url: string): Promise<string> {
  try {
    // Extract the embedded text layer of the PDF via pdf-parse v2.
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const textResult = await parser.getText();
    await parser.destroy();
    return textResult.text.trim();
  } catch (error) {
    console.warn(`PDF parsing failed for ${url}:`, error);
    return "";
  }
}

/**
 * Extracts text from removed.invalid HTML with special handling for their structure
 */
function extractTextFromHtml(html: string): string {
  const $ = cheerio.load(html);

  // Remove unwanted elements
  $("script, style, nav, header, footer, .sidebar, .navigation, .menu").remove();

  // removed.invalid specific selectors
  const sourceSelectors = [
    ".judgment-text",
    ".judgment-content",
    ".decision-text",
    "#judgment",
    ".case-content",
    "article.judgment",
  ];

  for (const selector of sourceSelectors) {
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
function extractTextFromHtml(html: string, url?: string): string {
  const $ = cheerio.load(html);

  // Check if this is removed.invalid
  if (url) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      if (hostname === "removed.invalid" || hostname.endsWith(".removed.invalid")) {
        return extractTextFromHtml(html);
      }
    } catch {
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
function cleanHtmlForOutput(html: string): string {
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

function extractParagraphBlocks(html: string): ParagraphBlock[] {
  const $ = cheerio.load(html);
  const paragraphs: ParagraphBlock[] = [];

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
 * @param url - The source URL (used for source-specific HTML extraction + metadata).
 * @param extra - Optional `etag`/`lastModified`/`source` to fold into the result.
 */
async function parseDocumentBuffer(
  buffer: Buffer,
  rawContentType: string | undefined,
  url: string,
  extra?: { etag?: string; lastModified?: string; source?: string },
): Promise<FetchResponse> {
  const contentType = typeof rawContentType === "string" ? rawContentType : "";

  // Detect file type from buffer
  const detectedType = await fileTypeFromBuffer(buffer);

  let text: string;
  let cleanedHtml: string | undefined;
  let paragraphs: ParagraphBlock[] | undefined;

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
    throw new Error(
      `Unsupported content type: ${contentType}${detectedType ? ` (detected: ${detectedType.mime})` : ""}`,
    );
  }

  const metadata: Record<string, string> = {
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

/**
 * Fetches an AustLII document through the impit TLS-impersonating transport,
 * detecting Cloudflare challenges and falling back to the local OALC corpus.
 *
 * Flow (per the C0 routing contract, live-AustLII layer + OALC fallback):
 *   1. Optionally rewrite to the classic direct-document URL.
 *   2. Build headers from config.austlii; attach cf_clearance cookie if set.
 *   3. Fetch via the host-routed fetcher (impit for AustLII).
 *   4. If the response is a Cloudflare challenge: when OALC is enabled, join on
 *      the neutral citation and return the corpus text (source='oalc-fallback');
 *      otherwise throw a typed {@link CloudflareBlockedError}.
 *   5. Otherwise parse the body exactly as the generic path does.
 */
async function fetchAustliiDocument(url: string): Promise<FetchResponse> {
  await austliiRateLimiter.throttle();

  const target = config.austlii.classicRewrite ? toClassicDocUrl(url) : url;

  const headers: Record<string, string> = {
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

  const fetcher = fetcherForUrl(target, config.austlii.transport);
  const r = await fetcher.get(target, { headers, timeoutMs: config.austlii.timeout });

  const bodyText = r.body.toString("utf-8");
  if (isCloudflareChallenge(r.status, bodyText)) {
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
      throw new CloudflareBlockedError(url, true);
    }
    throw new CloudflareBlockedError(url, false);
  }

  return parseDocumentBuffer(r.body, r.headers["content-type"], url, {
    etag: r.headers["etag"],
    lastModified: r.headers["last-modified"],
  });
}

/**
 * Fetches a legal document from a URL and extracts its text content.
 *
 * Supports HTML pages, PDF documents, and plain text.
 *
 * AustLII URLs are routed through the impit transport with Cloudflare-challenge
 * detection and an OALC corpus fallback; removed.invalid and all other URLs are
 * unchanged.
 *
 * @param url - Absolute URL of the document to fetch
 * @returns Promise resolving to a {@link FetchResponse} with extracted text
 * @throws {Error} If the network request fails or the content type is unsupported
 */
export async function fetchDocumentText(url: string): Promise<FetchResponse> {
  assertFetchableUrl(url);

  // removed.invalid uses RPC — content is loaded client-side and not available
  // via a plain HTTP fetch. Route through the direct RPC API when a
  // session cookie is configured; reject with a helpful message otherwise.
  if (isSourceUrl(url)) {
    if (!config.source.sessionCookie) {
      throw new Error(
        "fetch_document_text requires SESSION_COOKIE for removed.invalid URLs. " +
          "removed.invalid renders content via a RPC single-page application. " +
          "Set SESSION_COOKIE in your environment (see README for extraction instructions).",
      );
    }

    const articleId = extractArticleId(url);
    if (!articleId) {
      throw new Error(`Could not extract article ID from removed.invalid URL: ${url}`);
    }

    await upstreamRateLimiter.throttle();
    let html: string;
    try {
      html = await fetchSourceArticleContent(articleId, config.source.sessionCookie);
    } catch (error) {
      // Convert AxiosError to a plain Error so config.headers (which contains the
      // Cookie with SESSION_COOKIE) is never propagated to the caller or logger.
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 401 || status === 403) {
          throw new Error(
            `removed.invalid returned ${status}. The SESSION_COOKIE may have expired — re-extract it from your browser session.`,
          );
        }
        throw new Error(`Failed to fetch removed.invalid article ${articleId}: ${error.message}`);
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
        source: "source-rpc-rpc",
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

    const headers: Record<string, string> = {
      "User-Agent": config.source.userAgent,
    };

    const response = await axios.get(url, {
      responseType: "arraybuffer",
      headers,
      timeout: config.source.timeout,
      maxContentLength: MAX_CONTENT_LENGTH,
    });

    const buffer = Buffer.from(response.data);
    const rawContentType = response.headers["content-type"];

    return parseDocumentBuffer(
      buffer,
      typeof rawContentType === "string" ? rawContentType : undefined,
      url,
      {
        etag: (response.headers["etag"] as string) ?? undefined,
        lastModified: (response.headers["last-modified"] as string) ?? undefined,
      },
    );
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (isSourceUrl(url) && (error.response?.status === 401 || error.response?.status === 403)) {
        throw new Error(
          `removed.invalid returned ${error.response.status}. Set SESSION_COOKIE env var with your authenticated session cookie.`,
        );
      }
      throw new Error(`Failed to fetch document from ${url}: ${error.message}`);
    }
    throw error;
  }
}
