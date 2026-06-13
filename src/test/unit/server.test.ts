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
  "source_lookup",
  "format_citation",
  "resolve_citation",
  "search_citing_cases",
  "cite",
  "bibliography",
  "cache_cited_by",
  // WS-E deterministic / graph / semantic recall tools.
  "get_provision",
  "get_act_structure",
  "list_data_modules",
  "find_citing",
  "semantic_search_local",
];

/** Old tool names removed in the R5 breaking cut — must NOT be registered. */
const REMOVED_TOOLS = [
  "generate_pinpoint",
  "format_short_citation",
  "validate_citation",
  "search_by_citation",
  "resolve_source_article",
  "source_citation_lookup",
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

  it("does not register any pre-R5 tool names (no aliases)", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const names = new Set(tools.map((t) => t.name));
    for (const old of REMOVED_TOOLS) {
      expect(names.has(old), `removed tool still registered: ${old}`).toBe(false);
    }
  });
});

describe("mode/op/action/by dispatch validation", () => {
  it("source_lookup rejects by=article_id without articleId", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "source_lookup",
      arguments: { by: "article_id" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("articleId is required");
  });

  it("source_lookup rejects by=citation without citation", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "source_lookup",
      arguments: { by: "citation" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("citation is required");
  });

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

  it("source_lookup by=citation builds a lookup URL without network access", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "source_lookup",
      arguments: { by: "citation", citation: "[2008] NSWSC 323" },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    const parsed = JSON.parse(text) as { citation: string; sourceUrl: string };
    expect(parsed.citation).toBe("[2008] NSWSC 323");
    expect(parsed.sourceUrl).toContain("removed.invalid");
  });
});
