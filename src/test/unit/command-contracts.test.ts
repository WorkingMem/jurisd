import { describe, expect, it } from "vitest";
import { COMMAND_CONTRACTS, getCommandContractByCliName } from "../../commands/contracts.js";

const FLAG_PATTERN = /--[a-z][a-z0-9-]*/g;

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cliName(contract: (typeof COMMAND_CONTRACTS)[number]): string {
  return contract.adapters.cli.canonicalName ?? contract.id;
}

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

  it("keeps TUI enablement explicit with conditional network reads gated", () => {
    const enabled = COMMAND_CONTRACTS.filter((contract) => contract.adapters.tui.enabled).map(
      (contract) => contract.id,
    );

    expect(enabled.sort()).toEqual(
      [
        "cite.format",
        "corpus.getActStructure",
        "corpus.getProvision",
        "corpus.listDataModules",
        "graph.findCiting",
        "search.cases",
        "search.legislation",
        "search.semanticLocal",
      ].sort(),
    );
    expect(getCommandContractByCliName("search-cases")?.adapters.tui.networkPolicy).toBe(
      "accepted_safe_default",
    );
    expect(getCommandContractByCliName("search-legislation")?.adapters.tui.networkPolicy).toBe(
      "accepted_safe_default",
    );
    expect(getCommandContractByCliName("format-citation")?.adapters.tui.authorityNote).toContain(
      "mode=pinpoint",
    );
    expect(getCommandContractByCliName("fetch-document-text")?.adapters.tui.enabled).toBe(false);
    expect(getCommandContractByCliName("cite")?.adapters.tui.enabled).toBe(false);
    expect(getCommandContractByCliName("bibliography")?.adapters.tui.enabled).toBe(false);
    expect(getCommandContractByCliName("fetch-module")?.adapters.tui.enabled).toBe(false);
  });

  it("keeps documented CLI invocations aligned with declared commands and flags", () => {
    for (const contract of COMMAND_CONTRACTS.filter((item) => item.adapters.cli.enabled)) {
      const commandName = cliName(contract);
      const commandPattern = new RegExp(`^jurisd ${escapeRegExp(commandName)}(\\s|$)`);
      const declaredFlags = new Set(contract.flags.map((flag) => `--${flag.name}`));
      const invocations = [contract.synopsis, ...contract.examples];

      for (const invocation of invocations) {
        expect(invocation, `${contract.id} documents a real CLI command`).toMatch(commandPattern);

        for (const usedFlag of invocation.match(FLAG_PATTERN) ?? []) {
          expect(
            declaredFlags.has(usedFlag) || usedFlag === "--help",
            `${contract.id} documents undeclared flag ${usedFlag}`,
          ).toBe(true);
        }
      }
    }
  });
});
