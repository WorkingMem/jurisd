import { describe, it, expect } from "vitest";
import { mergeCaseSearchResults } from "../../services/search-merge.js";
import type { SearchResult } from "../../services/austlii.js";

function makeAustlii(overrides: Partial<SearchResult>): SearchResult {
  return {
    title: "AustLII Case",
    url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
    source: "austlii",
    type: "case",
    ...overrides,
  };
}

function makeSource(overrides: Partial<SearchResult>): SearchResult {
  return {
    title: "Upstream Source Case",
    url: "https://removed.invalid/article/67683",
    source: "source",
    type: "case",
    ...overrides,
  };
}

describe("mergeCaseSearchResults", () => {
  it("prefers removed.invalid result when neutral citations collide", () => {
    const austliiResults = [
      makeAustlii({
        title: "Mabo v Queensland (No 2) [1992] HCA 23",
        neutralCitation: "[1992] HCA 23",
      }),
    ];
    const upstreamResults = [
      makeSource({
        title: "Mabo v Queensland (No 2) [1992] HCA 23",
        neutralCitation: "[1992] HCA 23",
        reportedCitation: "(1992) 175 CLR 1",
      }),
    ];

    const merged = mergeCaseSearchResults(austliiResults, upstreamResults);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.source).toBe("source");
    expect(merged[0]?.reportedCitation).toBe("(1992) 175 CLR 1");
  });

  it("retains distinct results when neutral citations differ", () => {
    const austliiResults = [
      makeAustlii({ neutralCitation: "[2024] HCA 1", title: "Case A [2024] HCA 1" }),
    ];
    const upstreamResults = [
      makeSource({ neutralCitation: "[2024] HCA 2", title: "Case B [2024] HCA 2" }),
    ];

    const merged = mergeCaseSearchResults(austliiResults, upstreamResults);
    expect(merged).toHaveLength(2);
  });

  it("deduplicates fallback-url results without neutral citations by URL", () => {
    const austliiResults = [
      makeAustlii({
        title: "Uncited Case",
        neutralCitation: undefined,
        url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/nsw/NSWSC/2024/1.html",
      }),
    ];
    const upstreamResults: SearchResult[] = [];

    const merged = mergeCaseSearchResults(austliiResults, upstreamResults);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.url).toContain("/NSWSC/2024/1.html");
  });

  it("applies limit for paged user flows and retains source-first ordering", () => {
    const austliiResults = [
      makeAustlii({ neutralCitation: "[2024] HCA 1", title: "Case A [2024] HCA 1" }),
      makeAustlii({
        neutralCitation: "[2024] HCA 2",
        title: "Case B [2024] HCA 2",
        url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/2024/2.html",
      }),
    ];
    const upstreamResults = [
      makeSource({
        neutralCitation: "[2024] HCA 3",
        title: "Case C [2024] HCA 3",
        url: "https://removed.invalid/article/123456",
      }),
    ];

    const merged = mergeCaseSearchResults(austliiResults, upstreamResults, 2);
    expect(merged).toHaveLength(2);
    // source result should occupy the first slot (source is preferred / iterated first)
    expect(merged[0]?.source).toBe("source");
    expect(merged[0]?.neutralCitation).toBe("[2024] HCA 3");
    expect(merged[1]?.source).toBe("austlii");
    expect(merged[1]?.neutralCitation).toBe("[2024] HCA 1");
  });
});
