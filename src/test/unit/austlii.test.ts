import { describe, it, expect } from "vitest";
import {
  calculateAuthorityScore,
  extractReportedCitation,
  isCaseNameQuery,
  determineSortMode,
  buildSearchParams,
  boostTitleMatches,
} from "../../services/austlii.js";
import type { SearchResult, SearchOptions } from "../../services/austlii.js";

describe("calculateAuthorityScore", () => {
  it("HCA scores higher than NSWSC", () => {
    const hca: SearchResult = {
      url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/2024/1.html",
      title: "Test",
      source: "austlii",
      type: "case",
    };
    const nswsc: SearchResult = {
      url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/nsw/NSWSC/2024/1.html",
      title: "Test",
      source: "austlii",
      type: "case",
    };
    expect(calculateAuthorityScore(hca)).toBeGreaterThan(calculateAuthorityScore(nswsc));
  });

  it("FCAFC scores higher than FCA", () => {
    const fcafc: SearchResult = {
      url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/FCAFC/2024/1.html",
      title: "Test",
      source: "austlii",
      type: "case",
    };
    const fca: SearchResult = {
      url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/FCA/2024/1.html",
      title: "Test",
      source: "austlii",
      type: "case",
    };
    expect(calculateAuthorityScore(fcafc)).toBeGreaterThan(calculateAuthorityScore(fca));
  });

  it("reported citation adds score", () => {
    const withReported: SearchResult = {
      url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/nsw/NSWSC/2024/1.html",
      title: "Test",
      source: "austlii",
      type: "case",
      reportedCitation: "(2024) 350 ALR 123",
    };
    const withoutReported: SearchResult = {
      url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/nsw/NSWSC/2024/1.html",
      title: "Test",
      source: "austlii",
      type: "case",
    };
    expect(calculateAuthorityScore(withReported)).toBeGreaterThan(
      calculateAuthorityScore(withoutReported),
    );
  });

  it("unknown court gets score 0", () => {
    const unknown: SearchResult = {
      url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/other/UNKNOWN/2024/1.html",
      title: "Test",
      source: "austlii",
      type: "case",
    };
    expect(calculateAuthorityScore(unknown)).toBe(0);
  });
});

describe("extractReportedCitation", () => {
  it("extracts CLR citation", () => {
    expect(extractReportedCitation("(1992) 175 CLR 1")).toBe("(1992) 175 CLR 1");
  });

  it("extracts ALR citation", () => {
    expect(extractReportedCitation("(2024) 350 ALR 123")).toBe("(2024) 350 ALR 123");
  });

  it("extracts citation from surrounding text", () => {
    const result = extractReportedCitation("Mabo v Queensland (1992) 175 CLR 1 at [20]");
    expect(result).toBe("(1992) 175 CLR 1");
  });

  it("returns undefined for non-citation text", () => {
    expect(extractReportedCitation("no citation here")).toBeUndefined();
  });

  it("returns undefined for neutral citation only", () => {
    expect(extractReportedCitation("[2022] HCA 5")).toBeUndefined();
  });
});

describe("isCaseNameQuery", () => {
  it("detects X v Y pattern", () => {
    expect(isCaseNameQuery("Donoghue v Stevenson")).toBe(true);
  });

  it("detects X v. Y pattern with period", () => {
    expect(isCaseNameQuery("Mabo v. Queensland")).toBe(true);
  });

  it("detects Re X pattern", () => {
    expect(isCaseNameQuery("Re Wakim")).toBe(true);
  });

  it("detects In re X pattern", () => {
    expect(isCaseNameQuery("In re Smith")).toBe(true);
  });

  it("detects citation pattern", () => {
    expect(isCaseNameQuery("[2024] HCA 26")).toBe(true);
  });

  it("detects quoted query", () => {
    expect(isCaseNameQuery('"Donoghue v Stevenson"')).toBe(true);
  });

  it("returns false for topic query", () => {
    expect(isCaseNameQuery("negligence duty of care")).toBe(false);
  });

  it("returns false for legislation query", () => {
    expect(isCaseNameQuery("Privacy Act 1988")).toBe(false);
  });
});

describe("determineSortMode", () => {
  it("returns relevance when sortBy is relevance", () => {
    const opts: SearchOptions = { type: "case", sortBy: "relevance" };
    expect(determineSortMode("anything", opts)).toBe("relevance");
  });

  it("returns date when sortBy is date", () => {
    const opts: SearchOptions = { type: "case", sortBy: "date" };
    expect(determineSortMode("Mabo v Queensland", opts)).toBe("date");
  });

  it("auto mode: case name query returns relevance", () => {
    const opts: SearchOptions = { type: "case", sortBy: "auto" };
    expect(determineSortMode("Mabo v Queensland", opts)).toBe("relevance");
  });

  it("auto mode: topic query returns date", () => {
    const opts: SearchOptions = { type: "case", sortBy: "auto" };
    expect(determineSortMode("negligence duty of care", opts)).toBe("date");
  });

  it("auto mode: legislation type returns date even for case name pattern", () => {
    const opts: SearchOptions = { type: "legislation", sortBy: "auto" };
    expect(determineSortMode("Mabo v Queensland", opts)).toBe("date");
  });

  it("no sortBy defaults to date for topic", () => {
    const opts: SearchOptions = { type: "case" };
    expect(determineSortMode("negligence", opts)).toBe("date");
  });
});

describe("buildSearchParams", () => {
  it("sets meta to /au for Australian jurisdiction", () => {
    const opts: SearchOptions = { type: "case", jurisdiction: "cth" };
    const params = buildSearchParams("test", opts);
    expect(params.meta).toBe("/au");
  });

  it("sets mask_path for cth cases", () => {
    const opts: SearchOptions = { type: "case", jurisdiction: "cth" };
    const params = buildSearchParams("test", opts);
    expect(params.mask_path).toBe("au/cases/cth");
  });

  it("sets mask_path for nsw legislation", () => {
    const opts: SearchOptions = { type: "legislation", jurisdiction: "nsw" };
    const params = buildSearchParams("test", opts);
    expect(params.mask_path).toBe("au/legis/nsw");
  });

  it("sets /austlii meta for NZ jurisdiction", () => {
    const opts: SearchOptions = { type: "case", jurisdiction: "nz" };
    const params = buildSearchParams("test", opts);
    expect(params.meta).toBe("/austlii");
    expect(params.mask_path).toBe("nz/cases");
  });

  it("uses au/cases mask_path when no jurisdiction specified", () => {
    const opts: SearchOptions = { type: "case" };
    const params = buildSearchParams("test", opts);
    expect(params.mask_path).toBe("au/cases");
  });

  it("propagates offset", () => {
    const opts: SearchOptions = { type: "case", offset: 50 };
    const params = buildSearchParams("test", opts);
    expect(params.offset).toBe(50);
  });

  it("sets method from options", () => {
    const opts: SearchOptions = { type: "case", method: "phrase" };
    const params = buildSearchParams("test", opts);
    expect(params.method).toBe("phrase");
  });

  it("defaults method to auto when not specified", () => {
    const opts: SearchOptions = { type: "case" };
    const params = buildSearchParams("test", opts);
    expect(params.method).toBe("auto");
  });
});

describe("boostTitleMatches", () => {
  const makeResult = (title: string): SearchResult => ({
    title,
    url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/2024/1.html",
    source: "austlii",
    type: "case",
  });

  it("boosts exact case name match to the top", () => {
    const results = [
      makeResult("Smith v Jones (citing Mabo v Queensland)"),
      makeResult("Mabo v Queensland (No 2) [1992] HCA 23"),
      makeResult("Other case about native title"),
    ];
    const boosted = boostTitleMatches(results, "Mabo v Queensland");
    expect(boosted[0]!.title).toContain("Mabo v Queensland (No 2)");
  });

  it("both parties matching gives higher score than one party", () => {
    const results = [makeResult("Mabo v Smith"), makeResult("Mabo v Queensland (No 2)")];
    const boosted = boostTitleMatches(results, "Mabo v Queensland");
    expect(boosted[0]!.title).toContain("Queensland");
  });

  it("returns all results with order changed", () => {
    const results = [makeResult("Smith v Jones"), makeResult("Mabo v Queensland (No 2)")];
    const boosted = boostTitleMatches(results, "Mabo v Queensland");
    expect(boosted).toHaveLength(2);
  });
});
