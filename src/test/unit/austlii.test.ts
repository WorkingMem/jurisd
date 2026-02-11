import { describe, it, expect } from "vitest";
import {
  isCaseNameQuery,
  determineSortMode,
  boostTitleMatches,
  extractReportedCitation,
} from "../../services/austlii.js";
import type { SearchResult, SearchOptions } from "../../services/austlii.js";

describe("isCaseNameQuery", () => {
  it("should detect 'X v Y' pattern", () => {
    expect(isCaseNameQuery("Donoghue v Stevenson")).toBe(true);
    expect(isCaseNameQuery("Mabo v Queensland")).toBe(true);
    expect(isCaseNameQuery("Smith v Jones")).toBe(true);
  });

  it("should detect 'X v. Y' pattern with period", () => {
    expect(isCaseNameQuery("Smith v. Jones")).toBe(true);
  });

  it("should detect 'Re X' pattern", () => {
    expect(isCaseNameQuery("Re Wakim")).toBe(true);
    expect(isCaseNameQuery("Re Bolton")).toBe(true);
  });

  it("should detect 'In re X' pattern", () => {
    expect(isCaseNameQuery("In re Wakim")).toBe(true);
  });

  it("should detect citation patterns", () => {
    expect(isCaseNameQuery("[1992] HCA 23")).toBe(true);
    expect(isCaseNameQuery("[2024] NSWSC 100")).toBe(true);
    expect(isCaseNameQuery("[2025] FCA 456")).toBe(true);
  });

  it("should detect quoted queries", () => {
    expect(isCaseNameQuery('"specific case name"')).toBe(true);
  });

  it("should not detect topic searches", () => {
    expect(isCaseNameQuery("negligence duty of care")).toBe(false);
    expect(isCaseNameQuery("contract breach damages")).toBe(false);
    expect(isCaseNameQuery("unfair dismissal")).toBe(false);
    expect(isCaseNameQuery("property rights")).toBe(false);
  });
});

describe("determineSortMode", () => {
  const caseOptions: SearchOptions = { type: "case" };
  const legisOptions: SearchOptions = { type: "legislation" };

  it("should return 'relevance' when explicitly set", () => {
    expect(determineSortMode("anything", { ...caseOptions, sortBy: "relevance" })).toBe("relevance");
  });

  it("should return 'date' when explicitly set", () => {
    expect(determineSortMode("anything", { ...caseOptions, sortBy: "date" })).toBe("date");
  });

  it("should auto-detect case name queries as relevance", () => {
    expect(determineSortMode("Smith v Jones", { ...caseOptions, sortBy: "auto" })).toBe("relevance");
    expect(determineSortMode("Re Wakim", { ...caseOptions, sortBy: "auto" })).toBe("relevance");
  });

  it("should auto-detect topic queries as date", () => {
    expect(determineSortMode("negligence duty of care", { ...caseOptions, sortBy: "auto" })).toBe("date");
    expect(determineSortMode("contract breach", { ...caseOptions, sortBy: "auto" })).toBe("date");
  });

  it("should default to date for legislation searches even with case name pattern", () => {
    expect(determineSortMode("Smith v Jones", { ...legisOptions, sortBy: "auto" })).toBe("date");
  });

  it("should default to date when sortBy is not set", () => {
    expect(determineSortMode("negligence", caseOptions)).toBe("date");
  });

  it("should default to auto mode (relevance for case names) when sortBy is omitted", () => {
    // sortBy is omitted entirely (not even set to "auto")
    expect(determineSortMode("Smith v Jones", caseOptions)).toBe("relevance");
  });
});

describe("extractReportedCitation", () => {
  it("should extract round-bracket reported citations", () => {
    expect(extractReportedCitation("(2024) 350 ALR 123")).toBe("(2024) 350 ALR 123");
    expect(extractReportedCitation("(1992) 175 CLR 1")).toBe("(1992) 175 CLR 1");
    expect(extractReportedCitation("(2024) 98 ALJR 456")).toBe("(2024) 98 ALJR 456");
  });

  it("should extract square-bracket reported citations", () => {
    expect(extractReportedCitation("[2024] 1 NZLR 456")).toBe("[2024] 1 NZLR 456");
  });

  it("should extract from longer text", () => {
    const text = "Mabo v Queensland (No 2) (1992) 175 CLR 1 - High Court of Australia";
    expect(extractReportedCitation(text)).toBe("(1992) 175 CLR 1");
  });

  it("should return undefined for text without reported citations", () => {
    expect(extractReportedCitation("Donoghue v Stevenson")).toBeUndefined();
    expect(extractReportedCitation("negligence duty of care")).toBeUndefined();
    expect(extractReportedCitation("")).toBeUndefined();
  });

  it("should return undefined for neutral citations only", () => {
    // Neutral citations like [2024] HCA 26 have non-numeric third part
    expect(extractReportedCitation("[2024] HCA 26")).toBeUndefined();
  });
});

describe("boostTitleMatches", () => {
  const makeResult = (title: string): SearchResult => ({
    title,
    url: `https://www.austlii.edu.au/au/cases/cth/${title.replace(/\s/g, "_")}.html`,
    source: "austlii",
    type: "case",
  });

  it("should boost exact party name matches to the top", () => {
    const results = [
      makeResult("Other Case v Someone [2025] HCA 1"),
      makeResult("Donoghue v Stevenson [1932] UKHL 100"),
      makeResult("Another Case [2024] FCA 99"),
    ];

    const boosted = boostTitleMatches(results, "Donoghue v Stevenson");

    // Donoghue v Stevenson should be first
    expect(boosted[0]?.title).toContain("Donoghue");
    expect(boosted[0]?.title).toContain("Stevenson");
  });

  it("should rank partial matches below exact matches", () => {
    const results = [
      makeResult("Donoghue v Another [2020] HCA 5"),
      makeResult("Donoghue v Stevenson [1932] UKHL 100"),
      makeResult("Smith v Jones [2024] FCA 1"),
    ];

    const boosted = boostTitleMatches(results, "Donoghue v Stevenson");

    // Exact match (both parties) should be first
    expect(boosted[0]?.title).toContain("Stevenson");
    // Partial match (one party) should be before unrelated
    const donoghueIdx = boosted.findIndex((r) => r.title.includes("Donoghue v Another"));
    const smithIdx = boosted.findIndex((r) => r.title.includes("Smith"));
    expect(donoghueIdx).toBeLessThan(smithIdx);
  });

  it("should handle empty results", () => {
    expect(boostTitleMatches([], "Donoghue v Stevenson")).toEqual([]);
  });

  it("should handle queries without party names", () => {
    const results = [
      makeResult("Case A [2024] HCA 1"),
      makeResult("Case B [2024] FCA 2"),
    ];

    // Should not throw even without "v" pattern
    const boosted = boostTitleMatches(results, "negligence duty of care");
    expect(boosted).toHaveLength(2);
  });
});
