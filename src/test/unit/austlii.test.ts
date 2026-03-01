import { describe, it, expect } from "vitest";
import { calculateAuthorityScore } from "../../services/austlii.js";
import type { SearchResult } from "../../services/austlii.js";

describe("calculateAuthorityScore", () => {
  it("HCA scores higher than NSWSC", () => {
    const hca: SearchResult = {
      url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/2024/1.html",
      title: "Test", source: "austlii", type: "case",
    };
    const nswsc: SearchResult = {
      url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/nsw/NSWSC/2024/1.html",
      title: "Test", source: "austlii", type: "case",
    };
    expect(calculateAuthorityScore(hca)).toBeGreaterThan(calculateAuthorityScore(nswsc));
  });

  it("FCAFC scores higher than FCA", () => {
    const fcafc: SearchResult = {
      url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/FCAFC/2024/1.html",
      title: "Test", source: "austlii", type: "case",
    };
    const fca: SearchResult = {
      url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/FCA/2024/1.html",
      title: "Test", source: "austlii", type: "case",
    };
    expect(calculateAuthorityScore(fcafc)).toBeGreaterThan(calculateAuthorityScore(fca));
  });

  it("reported citation adds score", () => {
    const withReported: SearchResult = {
      url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/nsw/NSWSC/2024/1.html",
      title: "Test", source: "austlii", type: "case",
      reportedCitation: "(2024) 350 ALR 123",
    };
    const withoutReported: SearchResult = {
      url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/nsw/NSWSC/2024/1.html",
      title: "Test", source: "austlii", type: "case",
    };
    expect(calculateAuthorityScore(withReported)).toBeGreaterThan(calculateAuthorityScore(withoutReported));
  });

  it("unknown court gets score 0", () => {
    const unknown: SearchResult = {
      url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/other/UNKNOWN/2024/1.html",
      title: "Test", source: "austlii", type: "case",
    };
    expect(calculateAuthorityScore(unknown)).toBe(0);
  });
});
