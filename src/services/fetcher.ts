import axios from "axios";
import * as cheerio from "cheerio";
import { fileTypeFromBuffer } from "file-type";
import { PDFParse } from "pdf-parse";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as tmp from "tmp";
import * as fs from "fs/promises";

// Promisified execFile — passes argv as an array so shell metacharacters in
// any argument are not interpreted. Replaces the abandoned node-tesseract-ocr
// package (GHSA-8j44-735h-w4w2: OS command injection via recognize() params).
const execFileAsync = promisify(execFile);
import { config } from "../config.js";
import { MAX_CONTENT_LENGTH } from "../constants.js";
import { isSourceUrl, extractArticleId, fetchSourceArticleContent } from "./source.js";
import { assertFetchableUrl } from "../utils/url-guard.js";
import { austliiRateLimiter, upstreamRateLimiter } from "../utils/rate-limiter.js";

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
  ocrUsed: boolean;
  metadata?: Record<string, string>;
  paragraphs?: ParagraphBlock[];
  etag?: string;
  lastModified?: string;
}

async function extractTextFromPdf(
  buffer: Buffer,
  url: string,
): Promise<{ text: string; ocrUsed: boolean }> {
  try {
    // First try to extract text from PDF directly using pdf-parse v2 API
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const textResult = await parser.getText();
    await parser.destroy();
    const extractedText = textResult.text.trim();

    // If we got substantial text, return it
    if (extractedText.length > 100) {
      return { text: extractedText, ocrUsed: false };
    }

    // Otherwise, fall back to OCR
    console.warn(`PDF at ${url} has minimal text, attempting OCR...`);
    return await performOcr(buffer);
  } catch (error) {
    console.warn(`PDF parsing failed for ${url}, attempting OCR:`, error);
    return await performOcr(buffer);
  }
}

/**
 * Tesseract OCR via direct execFile (no shell). All arguments are passed
 * as an argv array so shell metacharacters cannot be interpreted. The input
 * path is a locally-generated tempfile (not user-controlled), and the OCR
 * config values come from env-var-backed `config.ocr.*` fields.
 */
async function performOcr(buffer: Buffer): Promise<{ text: string; ocrUsed: boolean }> {
  const tmpFile = tmp.fileSync({ postfix: ".pdf" });
  try {
    await fs.writeFile(tmpFile.name, buffer);

    // tesseract CLI: `tesseract <input> stdout -l <lang> --oem <n> --psm <n>`
    // Writing to stdout avoids a second tempfile for the output.
    const args = [
      tmpFile.name,
      "stdout",
      "-l",
      String(config.ocr.language),
      "--oem",
      String(config.ocr.oem),
      "--psm",
      String(config.ocr.psm),
    ];

    const { stdout } = await execFileAsync("tesseract", args, {
      // Allow up to 50 MB of recognised text — PDFs of full judgments can be large.
      maxBuffer: 50 * 1024 * 1024,
      // Fail fast on stuck tesseract (should never take more than a couple minutes).
      timeout: 180_000,
    });
    return { text: stdout.trim(), ocrUsed: true };
  } catch (error) {
    throw new Error(`OCR failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    tmpFile.removeCallback();
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
 * Fetches a legal document from a URL and extracts its text content.
 *
 * Supports HTML pages, PDF documents, and plain text. For scanned PDFs
 * with minimal extractable text the function falls back to Tesseract OCR.
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
      ocrUsed: false,
      metadata: {
        contentLength: String(html.length),
        contentType: "text/html",
        source: "source-rpc-rpc",
      },
      paragraphs,
    };
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
    const contentType = typeof rawContentType === "string" ? rawContentType : "";

    // Detect file type from buffer
    const detectedType = await fileTypeFromBuffer(buffer);

    let text: string;
    let cleanedHtml: string | undefined;
    let ocrUsed = false;
    let paragraphs: ParagraphBlock[] | undefined;

    // Handle PDF documents
    if (contentType.includes("application/pdf") || detectedType?.mime === "application/pdf") {
      const result = await extractTextFromPdf(buffer, url);
      text = result.text;
      ocrUsed = result.ocrUsed;
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

    // Extract basic metadata
    const metadata: Record<string, string> = {
      contentLength: String(buffer.length),
      contentType: contentType || detectedType?.mime || "unknown",
    };

    return {
      text,
      html: cleanedHtml,
      contentType: contentType || detectedType?.mime || "unknown",
      sourceUrl: url,
      ocrUsed,
      metadata,
      paragraphs,
      etag: (response.headers["etag"] as string) ?? undefined,
      lastModified: (response.headers["last-modified"] as string) ?? undefined,
    };
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
