import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

/**
 * Cost-ordered fallback matrix for search_cases:
 *   free providers (austlii live + jade) → Exa (if configured) → degraded result.
 * Two resilience properties:
 *   1. A Cloudflare block on AustLII must NOT take down jade results (the old
 *      Promise.all rejected the whole search).
 *   2. When nothing recovers results, the tool degrades gracefully (warnings +
 *      sources + degraded:true) rather than throwing — matching the upstream
 *      degraded-coverage contract in search-degradation.test.ts.
 */

const { searchAustLiiMock, searchJadeWithStatusMock, searchExaMock } = vi.hoisted(() => ({
  searchAustLiiMock: vi.fn(),
  searchJadeWithStatusMock: vi.fn(),
  searchExaMock: vi.fn(),
}));

vi.mock("../../services/austlii.js", () => ({ searchAustLii: searchAustLiiMock }));
vi.mock("../../services/exa.js", () => ({ searchAustliiViaExaWithStatus: searchExaMock }));
vi.mock("../../services/jade.js", () => ({
  searchJadeWithStatus: searchJadeWithStatusMock,
  searchJade: vi.fn(),
  resolveArticle: vi.fn(),
  buildCitationLookupUrl: vi.fn(),
  searchCitingCases: vi.fn(),
}));

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
  const [content] = result.content ?? [];
  const text = content?.type === "text" ? content.text : JSON.stringify(result.content);
  return { isError: result.isError === true, text };
}

describe("search_cases cost-ordered fallback matrix", () => {
  beforeEach(() => {
    searchAustLiiMock.mockReset();
    searchJadeWithStatusMock.mockReset();
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
    searchJadeWithStatusMock.mockResolvedValue({ results: [], status: "ok" });
    const { isError, text } = await callSearchCases();
    expect(isError).toBe(false);
    expect(text).toContain("HCA/2018/9");
    expect(searchExaMock).not.toHaveBeenCalled();
  });

  it("AustLII Cloudflare-blocked but jade has results → jade survives (resilience)", async () => {
    searchAustLiiMock.mockRejectedValue(new CloudflareBlockedError("https://austlii", false));
    searchJadeWithStatusMock.mockResolvedValue({
      results: [caseResult("Pike v Tighe", "https://jade.io/article/1", "[2018] HCA 9")],
      status: "ok",
    });
    const { isError, text } = await callSearchCases();
    expect(isError).toBe(false);
    expect(text).toContain("jade.io/article/1");
    expect(searchExaMock).not.toHaveBeenCalled();
  });

  it("free providers empty + Exa configured → Exa results", async () => {
    searchAustLiiMock.mockRejectedValue(new CloudflareBlockedError("https://austlii", false));
    searchJadeWithStatusMock.mockResolvedValue({ results: [], status: "not_configured" });
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
    searchJadeWithStatusMock.mockResolvedValue({ results: [], status: "not_configured" });
    const { isError, text } = await callSearchCases("[2018] HCA 9");
    expect(isError).toBe(false);
    expect(text).toContain("HCA/2018/9.html");
    expect(text).toContain("citation-url");
    expect(searchExaMock).not.toHaveBeenCalled();
  });

  it("nothing configured + AustLII blocked → degraded result naming the fallbacks", async () => {
    searchAustLiiMock.mockRejectedValue(new CloudflareBlockedError("https://austlii", false));
    searchJadeWithStatusMock.mockResolvedValue({ results: [], status: "not_configured" });
    // searchExaMock default resolves not_configured (no key configured)
    const { isError, text } = await callSearchCases();
    expect(isError).toBe(false);
    expect(text).toContain("degraded");
    expect(text).toContain("EXA_API_KEY");
    expect(text).toContain("JADE_SESSION_COOKIE");
    expect(text).toContain('"exa": "not_configured"');
    expect(searchExaMock).toHaveBeenCalledOnce();
  });

  it("genuine zero results (no challenge) → empty list, not an error", async () => {
    searchAustLiiMock.mockResolvedValue([]);
    searchJadeWithStatusMock.mockResolvedValue({ results: [], status: "ok" });
    const { isError } = await callSearchCases();
    expect(isError).toBe(false);
  });
});
