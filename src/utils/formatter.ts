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
    case "json":
      return {
        content: ensureContent(JSON.stringify(response, null, 2)),
        structuredContent: {
          format: "json",
          data: response,
        },
      };
    case "html":
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

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
