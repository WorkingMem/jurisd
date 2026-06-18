import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { FetchResponse } from "../services/fetcher.js";
import type { SearchResult } from "../services/austlii.js";
export type ResponseFormat = "json" | "text" | "markdown" | "html";
export declare function formatSearchResults(results: SearchResult[], format: ResponseFormat): CallToolResult;
/**
 * Formats a fetched document response into the requested output format.
 *
 * @param response - The fetch response containing the document text
 * @param format - Desired output format (json, text, markdown, or html)
 * @returns An MCP {@link CallToolResult} containing the formatted content
 */
export declare function formatFetchResponse(response: FetchResponse, format: ResponseFormat): CallToolResult;
//# sourceMappingURL=formatter.d.ts.map