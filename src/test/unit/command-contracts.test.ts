import { describe, expect, it } from "vitest";
import { COMMAND_CONTRACTS, getCommandContractByCliName } from "../../commands/contracts.js";

const REQUIRED_MCP_TOOLS = [
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

describe("command contracts", () => {
  it("defines one contract for each current MCP-backed CLI command", () => {
    const mcpTools = COMMAND_CONTRACTS.filter((contract) => contract.adapters.mcp.enabled)
      .map((contract) => contract.adapters.mcp.toolName)
      .sort();

    expect(mcpTools).toEqual(REQUIRED_MCP_TOOLS);
  });

  it("requires command metadata used by help and docs", () => {
    for (const contract of COMMAND_CONTRACTS) {
      expect(contract.id).toMatch(/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/);
      expect(contract.summary.length).toBeGreaterThan(8);
      expect(contract.synopsis.length).toBeGreaterThan(0);
      expect(contract.sideEffectClass).toBeTruthy();
      expect(contract.resultContract).toMatch(/\.v\d+$/);
      expect(contract.outputModes).toContain("human");
      expect(contract.outputModes).toContain("json");
    }
  });

  it("maps existing flat CLI command names to contracts", () => {
    expect(getCommandContractByCliName("search-cases")?.id).toBe("search.cases");
    expect(getCommandContractByCliName("format-citation")?.id).toBe("cite.format");
    expect(getCommandContractByCliName("semantic-search-local")?.id).toBe("search.semanticLocal");
  });
});
