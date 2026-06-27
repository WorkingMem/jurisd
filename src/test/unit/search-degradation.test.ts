import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { AustLiiError, CloudflareBlockedError } from "../../errors.js";
import { createMcpServer } from "../../server.js";
import type { SearchResult } from "../../services/austlii.js";

const mocks = vi.hoisted(() => ({
  searchAustLii: vi.fn(),
}));

vi.mock("../../services/austlii.js", () => ({
  searchAustLii: mocks.searchAustLii,
}));

async function connectedClient() {
  const server = createMcpServer();
  const client = new Client({ name: "search-degradation-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

function isCallToolResult(value: unknown): value is CallToolResult {
  return typeof value === "object" && value !== null && "content" in value;
}

function firstText(result: unknown): string {
  if (!isCallToolResult(result)) throw new Error("Unexpected tool-call result");
  const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
  return content.find((block) => block.type === "text")?.text ?? "";
}

async function callToolErrorText(
  client: Client,
  args: Parameters<Client["callTool"]>[0],
): Promise<string> {
  const outcome = await client.callTool(args).catch((error: unknown) => error);
  if (outcome instanceof Error) return outcome.message;
  if (!isCallToolResult(outcome)) throw new Error("Unexpected tool-call result");
  expect(outcome.isError).toBe(true);
  return firstText(outcome);
}

describe("AustLII search degradation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("search_cases returns AustLII results when the search succeeds", async () => {
    const austliiResult: SearchResult = {
      title: "Mabo v Queensland (No 2)",
      neutralCitation: "[1992] HCA 23",
      url: "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
      source: "austlii",
      type: "case",
      jurisdiction: "cth",
      year: "1992",
    };
    mocks.searchAustLii.mockResolvedValueOnce([austliiResult]);

    const { client, server } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "search_cases",
        arguments: { query: "Mabo", format: "json" },
      });

      expect(result.isError).not.toBe(true);
      const parsed = JSON.parse(firstText(result)) as Array<SearchResult & { aglc4: string }>;
      expect(parsed).toHaveLength(1);
      expect(parsed[0]!.source).toBe("austlii");
      expect(parsed[0]!.neutralCitation).toBe("[1992] HCA 23");
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });

  it("search_legislation returns a degraded success response when AustLII search is blocked", async () => {
    mocks.searchAustLii.mockRejectedValueOnce(
      new CloudflareBlockedError("https://www.austlii.edu.au/cgi-bin/sinosrch.cgi", false),
    );

    const { client, server } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "search_legislation",
        arguments: { query: "privacy", jurisdiction: "cth", format: "json" },
      });

      expect(result.isError).not.toBe(true);
      const parsed = JSON.parse(firstText(result)) as {
        results: SearchResult[];
        warnings: Array<{ code: string; source: string; message: string }>;
        sources: Record<string, string>;
        degraded: boolean;
      };
      expect(parsed.degraded).toBe(true);
      expect(parsed.sources).toEqual({ austlii: "blocked", exa: "not_configured" });
      expect(parsed.results).toEqual([]);
      expect(parsed.warnings[0]).toMatchObject({
        code: "austlii_cloudflare_blocked",
        source: "austlii",
      });
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });

  it("search_cases reports a Cloudflare block as a degraded result", async () => {
    mocks.searchAustLii.mockRejectedValueOnce(
      new CloudflareBlockedError("https://www.austlii.edu.au/cgi-bin/sinosrch.cgi", false),
    );

    const { client, server } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "search_cases",
        arguments: { query: "Mabo", format: "json" },
      });

      expect(result.isError).not.toBe(true);
      const parsed = JSON.parse(firstText(result)) as {
        results: SearchResult[];
        warnings: Array<{ code: string; source: string; message: string }>;
        sources: Record<string, string>;
        degraded: boolean;
      };
      expect(parsed).toMatchObject({
        results: [],
        degraded: true,
        sources: { austlii: "blocked", exa: "not_configured" },
      });
      expect(parsed.warnings[0]?.code).toBe("austlii_cloudflare_blocked");
      expect(parsed.warnings[0]!.message).not.toMatch(/cf_clearance|Cookie/);
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });

  it("search_legislation does not degrade non-Cloudflare AustLII failures", async () => {
    mocks.searchAustLii.mockRejectedValueOnce(
      new AustLiiError("AustLII search failed: redirect blocked", 500),
    );

    const { client, server } = await connectedClient();
    try {
      const text = await callToolErrorText(client, {
        name: "search_legislation",
        arguments: { query: "privacy", jurisdiction: "cth", format: "json" },
      });
      expect(text).toContain("AustLII search failed");
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });

  it("search_cases does not silently swallow unexpected AustLII failures", async () => {
    mocks.searchAustLii.mockRejectedValueOnce(new AustLiiError("transport failed", 500));

    const { client, server } = await connectedClient();
    try {
      const text = await callToolErrorText(client, {
        name: "search_cases",
        arguments: { query: "Mabo", format: "json" },
      });
      expect(text).toContain("transport failed");
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });
});
