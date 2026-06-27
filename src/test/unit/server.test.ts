import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createMcpServer } from "../../server.js";

/**
 * The consolidated tool surface: 10 base tools, plus the Layer-1 local-module
 * recall tools as they land.
 */
const EXPECTED_TOOLS = [
  "search_legislation",
  "search_cases",
  "fetch_document_text",
  "format_citation",
  "resolve_citation",
  "cite",
  "bibliography",
  // deterministic / graph / semantic recall tools.
  "get_provision",
  "get_act_structure",
  "list_data_modules",
  "find_citing",
  "semantic_search_local",
];

/** Old tool names removed in the tool-surface breaking cut — must NOT be registered. */
const REMOVED_TOOLS = [
  "generate_pinpoint",
  "format_short_citation",
  "validate_citation",
  "search_by_citation",
  "cache_citation",
  "check_source_freshness",
  "get_cached_citation",
  "list_bibliography",
  "export_bibliography",
  "get_cited_by",
];

async function connectedClient() {
  const server = createMcpServer();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("createMcpServer tool surface", () => {
  it("registers exactly the consolidated tool surface", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("does not register any pre-consolidation tool names (no aliases)", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const names = new Set(tools.map((t) => t.name));
    for (const old of REMOVED_TOOLS) {
      expect(names.has(old), `removed tool still registered: ${old}`).toBe(false);
    }
  });
});

describe("mode/op/action/by dispatch validation", () => {
  it("format_citation rejects pinpoint mode without url", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "format_citation",
      arguments: { mode: "pinpoint", phrase: "native title" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("url is required");
  });

  it("format_citation rejects subsequent mode without footnoteRef", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "format_citation",
      arguments: { mode: "subsequent", title: "Mabo" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("footnoteRef is required");
  });

  it("cite rejects action=refresh_source without citeKey", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "cite",
      arguments: { action: "refresh_source" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("citeKey is required");
  });

  it("bibliography rejects op=get without query", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "bibliography",
      arguments: { op: "get" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("query is required");
  });
});

describe("offline dispatch paths", () => {
  it("format_citation defaults to mode=full and formats AGLC4", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "format_citation",
      arguments: {
        title: "Mabo v Queensland (No 2)",
        neutralCitation: "[1992] HCA 23",
        reportedCitation: "(1992) 175 CLR 1",
      },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toContain("Mabo v Queensland (No 2)");
    expect(text).toContain("[1992] HCA 23");
    expect(text).toContain("(1992) 175 CLR 1");
  });

  it("format_citation mode=ibid produces an Ibid reference", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "format_citation",
      arguments: { mode: "ibid", title: "Mabo" },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text.toLowerCase()).toContain("ibid");
  });
});
