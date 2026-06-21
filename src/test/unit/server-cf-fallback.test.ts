import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

/**
 * Cost-ordered fallback matrix for search_cases:
 *   free providers (austlii live + source) → Exa (if configured) → degraded result.
 * Two resilience properties:
 *   1. A Cloudflare block on AustLII must NOT take down source results (the old
 *      Promise.all rejected the whole search).
 *   2. When nothing recovers results, the tool degrades gracefully (warnings +
 *      sources + degraded:true) rather than throwing — matching the upstream
 *      degraded-coverage contract in search-degradation.test.ts.
 */

const { searchAustLiiMock, searchUpstreamWithStatusMock, searchExaMock } = vi.hoisted(() => ({
  searchAustLiiMock: vi.fn(),
  searchUpstreamWithStatusMock: vi.fn(),
  searchExaMock: vi.fn(),
}));

vi.mock("../../services/austlii.js", () => ({ searchAustLii: searchAustLiiMock }));
vi.mock("../../services/exa.js", () => ({ searchAustliiViaExa: searchExaMock }));
vi.mock("../../services/source.js", () => ({
  searchUpstreamWithStatus: searchUpstreamWithStatusMock,
  searchUpstream: vi.fn(),
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

async function callSearchCases(): Promise<{ isError: boolean; text: string }> {
  const server = createMcpServer();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const result = await client.callTool({
    name: "search_cases",
    arguments: { query: "Pike v Tighe", limit: 5 },
  });
  return { isError: result.isError === true, text: JSON.stringify(result.content) };
}

describe("search_cases cost-ordered fallback matrix", () => {
  beforeEach(() => {
    searchAustLiiMock.mockReset();
    searchUpstreamWithStatusMock.mockReset();
    searchExaMock.mockReset();
    // Default: no Exa results (acts as "Exa not configured").
    searchExaMock.mockResolvedValue([]);
  });

  it("AustLII works → returns AustLII results (no Exa call)", async () => {
    searchAustLiiMock.mockResolvedValue([
      caseResult(
        "Pike v Tighe [2018] HCA 9",
        "https://www.austlii.edu.au/au/cases/cth/HCA/2018/9.html",
        "[2018] HCA 9",
      ),
    ]);
    searchUpstreamWithStatusMock.mockResolvedValue({ results: [], status: "ok" });
    const { isError, text } = await callSearchCases();
    expect(isError).toBe(false);
    expect(text).toContain("HCA/2018/9");
    expect(searchExaMock).not.toHaveBeenCalled();
  });

  it("AustLII Cloudflare-blocked but source has results → source survives (resilience)", async () => {
    searchAustLiiMock.mockRejectedValue(new CloudflareBlockedError("https://austlii", false));
    searchUpstreamWithStatusMock.mockResolvedValue({
      results: [caseResult("Pike v Tighe", "https://removed.invalid/article/1", "[2018] HCA 9")],
      status: "ok",
    });
    const { isError, text } = await callSearchCases();
    expect(isError).toBe(false);
    expect(text).toContain("removed.invalid/article/1");
    expect(searchExaMock).not.toHaveBeenCalled();
  });

  it("free providers empty + Exa configured → Exa results", async () => {
    searchAustLiiMock.mockRejectedValue(new CloudflareBlockedError("https://austlii", false));
    searchUpstreamWithStatusMock.mockResolvedValue({ results: [], status: "not_configured" });
    searchExaMock.mockResolvedValue([
      caseResult(
        "Pike v Tighe [2018] HCA 9",
        "https://www.austlii.edu.au/au/cases/cth/HCA/2018/9.html",
        "[2018] HCA 9",
      ),
    ]);
    const { isError, text } = await callSearchCases();
    expect(isError).toBe(false);
    expect(text).toContain("HCA/2018/9");
    expect(searchExaMock).toHaveBeenCalledOnce();
  });

  it("nothing configured + AustLII blocked → degraded result naming the fallbacks", async () => {
    searchAustLiiMock.mockRejectedValue(new CloudflareBlockedError("https://austlii", false));
    searchUpstreamWithStatusMock.mockResolvedValue({ results: [], status: "not_configured" });
    // searchExaMock default resolves [] (no key configured)
    const { isError, text } = await callSearchCases();
    expect(isError).toBe(false);
    expect(text).toContain("degraded");
    expect(text).toContain("EXA_API_KEY");
    expect(text).toContain("SESSION_COOKIE");
    expect(searchExaMock).toHaveBeenCalledOnce();
  });

  it("genuine zero results (no challenge) → empty list, not an error", async () => {
    searchAustLiiMock.mockResolvedValue([]);
    searchUpstreamWithStatusMock.mockResolvedValue({ results: [], status: "ok" });
    const { isError } = await callSearchCases();
    expect(isError).toBe(false);
  });
});
