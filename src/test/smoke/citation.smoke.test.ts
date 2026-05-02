/**
 * Smoke tests for citation formatting and parsing (pure functions — no network).
 * These always run regardless of CI flag.
 */
import { describe, it, expect } from "vitest";
import {
  formatAGLC4,
  parseCitation,
  normaliseCitation,
  isValidNeutralCitation,
  isValidReportedCitation,
  shortFormAGLC4,
} from "../../services/citation.js";

describe("formatAGLC4 round-trip", () => {
  it("formats and re-parses Mabo citation correctly", () => {
    const formatted = formatAGLC4({
      title: "Mabo v Queensland (No 2)",
      neutralCitation: "[1992] HCA 23",
      reportedCitation: "(1992) 175 CLR 1",
    });
    expect(formatted).toBe("Mabo v Queensland (No 2) [1992] HCA 23, (1992) 175 CLR 1");

    const parsed = parseCitation(formatted);
    expect(parsed?.neutralCitation).toBe("[1992] HCA 23");
    expect(parsed?.reportedCitations[0]).toBe("(1992) 175 CLR 1");
  });

  it("formats citation with pinpoint", () => {
    const formatted = formatAGLC4({
      title: "Mabo v Queensland (No 2)",
      neutralCitation: "[1992] HCA 23",
      pinpoint: "[20]",
    });
    expect(formatted).toBe("Mabo v Queensland (No 2) [1992] HCA 23 at [20]");
  });
});

describe("parseCitation", () => {
  it("extracts neutral citation from a complex string", () => {
    const result = parseCitation("See Mabo v Queensland (No 2) [1992] HCA 23 at [20]");
    expect(result?.neutralCitation).toBe("[1992] HCA 23");
    expect(result?.pinpoint).toBe("[20]");
  });

  it("returns null for non-citation text", () => {
    expect(parseCitation("hello world")).toBeNull();
  });
});

describe("normaliseCitation", () => {
  it("collapses internal whitespace", () => {
    expect(normaliseCitation("[1992]  HCA  23")).toBe("[1992] HCA 23");
  });

  it("trims surrounding whitespace", () => {
    expect(normaliseCitation("  (1992) 175 CLR 1  ")).toBe("(1992) 175 CLR 1");
  });
});

describe("isValidNeutralCitation", () => {
  it("accepts well-formed HCA citation", () => {
    expect(isValidNeutralCitation("[1992] HCA 23")).toBe(true);
  });

  it("rejects plain text", () => {
    expect(isValidNeutralCitation("not a citation")).toBe(false);
  });
});

describe("isValidReportedCitation", () => {
  it("accepts valid CLR citation", () => {
    expect(isValidReportedCitation("(1992) 175 CLR 1")).toBe(true);
  });

  it("rejects plain text", () => {
    expect(isValidReportedCitation("not a citation")).toBe(false);
  });
});

describe("shortFormAGLC4", () => {
  it("returns title with pinpoint", () => {
    expect(shortFormAGLC4("Mabo", "[20]")).toBe("Mabo [20]");
  });

  it("returns title without pinpoint when none provided", () => {
    expect(shortFormAGLC4("Mabo")).toBe("Mabo");
  });
});
