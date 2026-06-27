import * as cheerio from "cheerio";
import { fileTypeFromBuffer } from "file-type";
import { config } from "../config.js";
import { assertFetchableUrl } from "../utils/url-guard.js";
import { austliiRateLimiter } from "../utils/rate-limiter.js";
import {
  toClassicDocUrl,
  toWwwUrl,
  austliiUrlToNeutralCitation,
  austliiUrlIsLegislation,
} from "./austlii-url.js";
import { fetcherForUrl } from "./transport.js";
import { isCloudflareChallenge } from "./cloudflare.js";
import { lookupByCitation } from "./oalc.js";
import { CloudflareBlockedError, HttpStatusError } from "../errors.js";

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
    const { PDFParse } = await import("pdf-parse");
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
 * Generic HTML text extraction for AustLII and other sources
 */
function extractTextFromHtml(html: string): string {
  const $ = cheerio.load(html);

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
 * detected content type.
 *
 * @param buffer - Raw response bytes.
 * @param rawContentType - The `content-type` response header (may be undefined).
 * @param url - The source URL (recorded in metadata).
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
    text = extractTextFromHtml(rawHtml);
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

function uniqueUrls(urls: string[]): string[] {
  return Array.from(new Set(urls));
}

function austliiDocumentTargets(url: string): string[] {
  const classicDoc = toClassicDocUrl(url);
  const wwwDoc = toWwwUrl(classicDoc);
  const targets = config.austlii.classicRewrite
    ? [classicDoc, wwwDoc, url]
    : [url, classicDoc, wwwDoc];
  return uniqueUrls(targets);
}

function isAustliiOrigin(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "austlii.edu.au" || hostname.endsWith(".austlii.edu.au");
  } catch {
    return false;
  }
}

function assertFinalAustliiUrl(requestUrl: string, finalUrl: string): void {
  if (isAustliiOrigin(finalUrl)) {
    return;
  }
  throw new Error(`AustLII fetch redirected outside AustLII: ${requestUrl} -> ${finalUrl}`);
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
async function fetchAustliiDocument(url: string): Promise<FetchResponse> {
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

  let sawCloudflareChallenge = false;
  let challengedUrl = url;
  let lastError: unknown;

  for (const target of austliiDocumentTargets(url)) {
    let r;
    try {
      await austliiRateLimiter.throttle();
      const fetcher = fetcherForUrl(target, config.austlii.transport);
      r = await fetcher.get(target, { headers, timeoutMs: config.austlii.timeout });
    } catch (error) {
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

    try {
      assertFinalAustliiUrl(target, r.finalUrl);
    } catch (error) {
      lastError = error;
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
 * Only AustLII URLs are fetchable (enforced by {@link assertFetchableUrl}); they
 * are routed through the impit transport with Cloudflare-challenge detection and
 * an OALC corpus fallback.
 *
 * @param url - Absolute URL of the document to fetch
 * @returns Promise resolving to a {@link FetchResponse} with extracted text
 * @throws {Error} If the network request fails or the content type is unsupported
 */
export async function fetchDocumentText(url: string): Promise<FetchResponse> {
  assertFetchableUrl(url);
  return fetchAustliiDocument(url);
}
