import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

/**
 * Cost-ordered fallback matrix for search_cases:
 *   AustLII live → Exa (if configured) → degraded result.
 * When nothing recovers results, the tool degrades gracefully (warnings +
 * sources + degraded:true) rather than throwing — matching the upstream
 * degraded-coverage contract in search-degradation.test.ts.
 */

const { searchAustLiiMock, searchExaMock } = vi.hoisted(() => ({
  searchAustLiiMock: vi.fn(),
  searchExaMock: vi.fn(),
}));

vi.mock("../../services/austlii.js", () => ({ searchAustLii: searchAustLiiMock }));
vi.mock("../../services/exa.js", () => ({ searchAustliiViaExaWithStatus: searchExaMock }));

import { createMcpServer } from "../../server.js";
import { CloudflareBlockedError } from "../../errors.js";
import type { SearchResult } from "../../services/austlii.js";

function caseResult(title: string, url: string, neutral: string): SearchResult {
  return {
    title,
    neutralCitation: neutral,
    url,
    source: "austlii",
    type: "case",
  };
}

async function callSearchCases(
  query = "Pike v Tighe",
): Promise<{ isError: boolean; text: string }> {
  const server = createMcpServer();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const result = await client.callTool({
    name: "search_cases",
    arguments: { query, limit: 5 },
  });
  const resultContent = (result.content ?? []) as Array<{ type?: string; text?: string }>;
  const [content] = resultContent;
  const text = content?.type === "text" ? (content.text ?? "") : JSON.stringify(result.content);
  return { isError: result.isError === true, text };
}

describe("search_cases cost-ordered fallback matrix", () => {
  beforeEach(() => {
    searchAustLiiMock.mockReset();
    searchExaMock.mockReset();
    // Default: no Exa results (acts as "Exa not configured").
    searchExaMock.mockResolvedValue({ results: [], status: "not_configured" });
  });

  it("AustLII works → returns AustLII results (no Exa call)", async () => {
    searchAustLiiMock.mockResolvedValue([
      caseResult(
        "Pike v Tighe [2018] HCA 9",
        "https://www.austlii.edu.au/au/cases/cth/HCA/2018/9.html",
        "[2018] HCA 9",
      ),
    ]);
    const { isError, text } = await callSearchCases();
    expect(isError).toBe(false);
    expect(text).toContain("HCA/2018/9");
    expect(searchExaMock).not.toHaveBeenCalled();
  });

  it("AustLII empty + Exa configured → Exa results", async () => {
    searchAustLiiMock.mockRejectedValue(new CloudflareBlockedError("https://austlii", false));
    searchExaMock.mockResolvedValue({
      results: [
        caseResult(
          "Pike v Tighe [2018] HCA 9",
          "https://www.austlii.edu.au/au/cases/cth/HCA/2018/9.html",
          "[2018] HCA 9",
        ),
      ],
      status: "ok",
    });
    const { isError, text } = await callSearchCases();
    expect(isError).toBe(false);
    expect(text).toContain("HCA/2018/9");
    expect(searchExaMock).toHaveBeenCalledOnce();
  });

  it("AustLII Cloudflare-blocked + neutral citation query -> direct AustLII URL without paid search", async () => {
    searchAustLiiMock.mockRejectedValue(new CloudflareBlockedError("https://austlii", false));
    const { isError, text } = await callSearchCases("[2018] HCA 9");
    const payload = JSON.parse(text) as { results?: Array<{ aglc4?: string }> };
    expect(isError).toBe(false);
    expect(text).toContain("HCA/2018/9.html");
    expect(text).toContain("citation-url");
    expect(payload.results?.[0]?.aglc4).toBe("[2018] HCA 9");
    expect(searchExaMock).not.toHaveBeenCalled();
  });

  it("nothing configured + AustLII blocked → degraded result naming the fallbacks", async () => {
    searchAustLiiMock.mockRejectedValue(new CloudflareBlockedError("https://austlii", false));
    // searchExaMock default resolves not_configured (no key configured)
    const { isError, text } = await callSearchCases();
    expect(isError).toBe(false);
    expect(text).toContain("degraded");
    expect(text).toContain("EXA_API_KEY");
    expect(text).toContain('"exa": "not_configured"');
    expect(searchExaMock).toHaveBeenCalledOnce();
  });

  it("genuine zero results (no challenge) → empty list, not an error", async () => {
    searchAustLiiMock.mockResolvedValue([]);
    const { isError } = await callSearchCases();
    expect(isError).toBe(false);
  });
});
