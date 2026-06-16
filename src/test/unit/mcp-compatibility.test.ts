import { describe, expect, it } from "vitest";
import { createMcpServer } from "../../server.js";

const MCP_COMPATIBILITY_TOOL_NAMES = [
  "bibliography",
  "cache_cited_by",
  "cite",
  "fetch_document_text",
  "find_citing",
  "format_citation",
  "get_act_structure",
  "get_provision",
  "jade_lookup",
  "list_data_modules",
  "resolve_citation",
  "search_cases",
  "search_citing_cases",
  "search_legislation",
  "semantic_search_local",
].sort();

interface ToolBearingServer {
  _registeredTools: Record<string, unknown>;
}

function registeredToolNames(): string[] {
  const server = createMcpServer() as unknown as ToolBearingServer;
  return Object.keys(server._registeredTools).sort();
}

describe("MCP compatibility reference", () => {
  it("keeps the current 15 MCP tool names stable", () => {
    expect(registeredToolNames()).toEqual(MCP_COMPATIBILITY_TOOL_NAMES);
  });

  it("documents the current compatibility count", () => {
    expect(MCP_COMPATIBILITY_TOOL_NAMES).toHaveLength(15);
  });
});
