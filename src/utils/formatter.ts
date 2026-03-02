import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { FetchResponse } from "../services/fetcher.js";
import type { SearchResult } from "../services/austlii.js";

export type ResponseFormat = "json" | "text" | "markdown" | "html";

function ensureContent(text: string): CallToolResult["content"] {
  return text
    ? [
        {
          type: "text",
          text,
        },
      ]
    : [{ type: "text", text: "" }];
}

/**
 * Formats an array of search results into the requested output format.
 *
 * @param results - Search results to format
 * @param format - Desired output format (json, text, markdown, or html)
 * @returns An MCP {@link CallToolResult} containing the formatted content
 */
export function formatSearchResults(
  results: SearchResult[],
  format: ResponseFormat,
): CallToolResult {
  switch (format) {
    case "json":
      return {
        content: ensureContent(JSON.stringify(results, null, 2)),
        structuredContent: {
          format: "json",
          data: results,
        },
      };
    case "html": {
      const rows = results
        .map((result) => {
          const citation = result.citation ?? result.neutralCitation ?? "";
          const reported =
            result.reportedCitation && result.reportedCitation !== citation
              ? ` <span class="reported-citation">${escapeHtml(result.reportedCitation)}</span>`
              : "";
          const summary = result.summary ? `<p>${escapeHtml(result.summary)}</p>` : "";
          return `<li><a href="${escapeHtml(result.url)}">${escapeHtml(result.title)}</a>${
            citation ? ` (${escapeHtml(citation)})` : ""
          }${reported}${summary}</li>`;
        })
        .join("\n");
      return {
        content: ensureContent(`<ul>\n${rows}\n</ul>`),
      };
    }
    case "markdown": {
      const lines = results.map((result) => {
        const citation = result.citation ?? result.neutralCitation ?? "";
        const reported =
          result.reportedCitation && result.reportedCitation !== citation
            ? ` ${result.reportedCitation}`
            : "";
        const summary = result.summary ? ` - ${result.summary}` : "";
        return `- [${result.title}](${result.url})${citation ? ` (${citation})` : ""}${reported}${summary}`;
      });
      return {
        content: ensureContent(lines.join("\n")),
      };
    }
    case "text":
    default: {
      const lines = results.map((result, idx) => {
        const citation = result.citation ?? result.neutralCitation ?? "";
        const reported =
          result.reportedCitation && result.reportedCitation !== citation
            ? ` ${result.reportedCitation}`
            : "";
        const summary = result.summary ? `\n  ${result.summary}` : "";
        return `${idx + 1}. ${result.title}${citation ? ` (${citation})` : ""}${reported}\n   ${result.url}${summary}`;
      });
      return {
        content: ensureContent(lines.join("\n")),
      };
    }
  }
}

/**
 * Formats a fetched document response into the requested output format.
 *
 * @param response - The fetch response containing the document text
 * @param format - Desired output format (json, text, markdown, or html)
 * @returns An MCP {@link CallToolResult} containing the formatted content
 */
export function formatFetchResponse(
  response: FetchResponse,
  format: ResponseFormat,
): CallToolResult {
  switch (format) {
    case "json": {
      // Omit the bulky html field from JSON output; consumers should
      // request format=html when they need the styled document.
      const { html: _html, ...jsonSafe } = response;
      return {
        content: ensureContent(JSON.stringify(jsonSafe, null, 2)),
        structuredContent: {
          format: "json",
          data: jsonSafe,
        },
      };
    }
    case "html":
      if (response.html) {
        return {
          content: ensureContent(wrapInStyledDocument(response.html, response.sourceUrl)),
        };
      }
      return {
        content: ensureContent(
          `<article data-source="${escapeHtml(response.sourceUrl)}" data-ocr="${String(response.ocrUsed)}"><pre>${escapeHtml(response.text)}</pre></article>`,
        ),
      };
    case "markdown":
      return {
        content: ensureContent(`> Source: ${response.sourceUrl}\n\n${response.text}`),
      };
    case "text":
    default:
      return {
        content: ensureContent(response.text),
      };
  }
}

function wrapInStyledDocument(bodyHtml: string, sourceUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="source" content="${escapeHtml(sourceUrl)}">
<style>
  body {
    font-family: "Georgia", "Times New Roman", serif;
    font-size: 14px;
    line-height: 1.6;
    max-width: 800px;
    margin: 2em auto;
    padding: 0 1.5em;
    color: #222;
  }
  h1, h2, h3 { font-family: "Helvetica Neue", Arial, sans-serif; }
  h1 { font-size: 1.5em; border-bottom: 1px solid #ccc; padding-bottom: 0.3em; }
  h2 { font-size: 1.2em; margin-top: 1.5em; }
  p { margin: 0.8em 0; text-align: justify; }
  a { color: #1a5276; }
  @media print {
    body { margin: 0; padding: 0; max-width: none; font-size: 12px; }
  }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
