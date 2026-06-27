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

describe("mergeCaseSearchResults", () => {
  it("deduplicates results that share a neutral citation, keeping the first", () => {
    const results = [
      makeAustlii({
        title: "Mabo v Queensland (No 2) [1992] HCA 23",
        neutralCitation: "[1992] HCA 23",
      }),
      makeAustlii({
        title: "Mabo v Queensland (No 2) [1992] HCA 23",
        neutralCitation: "[1992] HCA 23",
        reportedCitation: "(1992) 175 CLR 1",
      }),
    ];

    const merged = mergeCaseSearchResults(results);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.reportedCitation).toBeUndefined();
  });

  it("retains distinct results when neutral citations differ", () => {
    const results = [
      makeAustlii({ neutralCitation: "[2024] HCA 1", title: "Case A [2024] HCA 1" }),
      makeAustlii({
        neutralCitation: "[2024] HCA 2",
        title: "Case B [2024] HCA 2",
        url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/2024/2.html",
      }),
    ];

    const merged = mergeCaseSearchResults(results);
    expect(merged).toHaveLength(2);
  });

  it("deduplicates results without neutral citations by URL", () => {
    const results = [
      makeAustlii({
        title: "Uncited Case",
        neutralCitation: undefined,
        url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/nsw/NSWSC/2024/1.html",
      }),
    ];

    const merged = mergeCaseSearchResults(results);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.url).toContain("/NSWSC/2024/1.html");
  });

  it("applies the limit for paged user flows while preserving order", () => {
    const results = [
      makeAustlii({ neutralCitation: "[2024] HCA 1", title: "Case A [2024] HCA 1" }),
      makeAustlii({
        neutralCitation: "[2024] HCA 2",
        title: "Case B [2024] HCA 2",
        url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/2024/2.html",
      }),
      makeAustlii({
        neutralCitation: "[2024] HCA 3",
        title: "Case C [2024] HCA 3",
        url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/2024/3.html",
      }),
    ];

    const merged = mergeCaseSearchResults(results, 2);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.neutralCitation).toBe("[2024] HCA 1");
    expect(merged[1]?.neutralCitation).toBe("[2024] HCA 2");
  });
});
