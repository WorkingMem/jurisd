import { describe, it, expect } from "vitest";
import { createMcpServer } from "../../server.js";

/**
 * WS-E tool-surface invariant: the consolidated R5 surface (10 live/citation)
 * plus the five WS-E local-module recall tools must register as exactly 15
 * distinct tools, with no stale pre-R5 names leaking back in.
 */
const EXPECTED_TOOLS = [
  // 10 live/citation (post-R5 consolidation)
  "search_legislation",
  "search_cases",
  "fetch_document_text",
  "source_lookup",
  "format_citation",
  "resolve_citation",
  "search_citing_cases",
  "cite",
  "bibliography",
  "cache_cited_by",
  // 5 WS-E local-module recall
  "get_provision",
  "get_act_structure",
  "find_citing",
  "semantic_search_local",
  "list_data_modules",
].sort();

interface ToolBearingServer {
  _registeredTools: Record<string, unknown>;
}

function registeredToolNames(): string[] {
  const server = createMcpServer() as unknown as ToolBearingServer;
  return Object.keys(server._registeredTools).sort();
}

describe("WS-E tool surface", () => {
  it("registers exactly 15 tools", () => {
    expect(registeredToolNames()).toHaveLength(15);
  });

  it("registers the expected 10 base + 5 WS-E names, with no stale names", () => {
    expect(registeredToolNames()).toEqual(EXPECTED_TOOLS);
  });
});
