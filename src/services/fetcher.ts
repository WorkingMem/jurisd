import axios from "axios";
import * as cheerio from "cheerio";
import { fileTypeFromBuffer } from "file-type";
import { pdf } from "pdf-parse";
import tesseract from "node-tesseract-ocr";
import * as tmp from "tmp";
import * as fs from "fs/promises";
import { config } from "../config.js";

export interface FetchResponse {
  text: string;
  contentType: string;
  sourceUrl: string;
  ocrUsed: boolean;
  metadata?: Record<string, string>;
}

async function extractTextFromPdf(
  buffer: Buffer,
  url: string,
): Promise<{ text: string; ocrUsed: boolean }> {
  try {
    // First try to extract text from PDF directly
    const pdfData = await pdf(buffer);
    const extractedText = pdfData.text.trim();

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

async function performOcr(buffer: Buffer): Promise<{ text: string; ocrUsed: boolean }> {
  // Create a temporary file for Tesseract
  const tmpFile = tmp.fileSync({ postfix: ".pdf" });
  try {
    await fs.writeFile(tmpFile.name, buffer);

    const ocrConfig = {
      lang: config.ocr.language,
      oem: config.ocr.oem,
      psm: config.ocr.psm,
    };

    const text = await tesseract.recognize(tmpFile.name, ocrConfig);
    return { text: text.trim(), ocrUsed: true };
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
  if (url && url.includes("removed.invalid")) {
    return extractTextFromHtml(html);
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

export async function fetchDocumentText(url: string): Promise<FetchResponse> {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      headers: {
        "User-Agent": "auslaw-mcp/0.1.0 (legal research tool)",
      },
      timeout: 30000,
      maxContentLength: 50 * 1024 * 1024, // 50MB limit
    });

    const buffer = Buffer.from(response.data);
    const contentType = response.headers["content-type"] || "";

    // Detect file type from buffer
    const detectedType = await fileTypeFromBuffer(buffer);

    let text: string;
    let ocrUsed = false;

    // Handle PDF documents
    if (contentType.includes("application/pdf") || detectedType?.mime === "application/pdf") {
      const result = await extractTextFromPdf(buffer, url);
      text = result.text;
      ocrUsed = result.ocrUsed;
    }
    // Handle HTML documents
    else if (contentType.includes("text/html") || detectedType?.mime === "text/html") {
      const html = buffer.toString("utf-8");
      text = extractTextFromHtml(html, url);
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
      contentType: contentType || detectedType?.mime || "unknown",
      sourceUrl: url,
      ocrUsed,
      metadata,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`Failed to fetch document from ${url}: ${error.message}`);
    }
    throw error;
  }
}
