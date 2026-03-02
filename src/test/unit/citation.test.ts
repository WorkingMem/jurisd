import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import {
  parseCitation,
  formatAGLC4,
  isValidNeutralCitation,
  isValidReportedCitation,
  shortFormAGLC4,
  normaliseCitation,
  validateCitation,
  generatePinpoint,
} from "../../services/citation.js";
import type { ParagraphBlock } from "../../services/fetcher.js";

describe("parseCitation", () => {
  it("extracts neutral citation from plain string", () => {
    const result = parseCitation("[2022] HCA 5");
    expect(result?.neutralCitation).toBe("[2022] HCA 5");
  });

  it("extracts neutral citation from surrounding text", () => {
    const result = parseCitation("See Mabo v Queensland (No 2) [1992] HCA 23 at [20]");
    expect(result?.neutralCitation).toBe("[1992] HCA 23");
    expect(result?.pinpoint).toBe("[20]");
  });

  it("extracts reported citation", () => {
    const result = parseCitation("(1992) 175 CLR 1");
    expect(result?.reportedCitations[0]).toBe("(1992) 175 CLR 1");
  });

  it("handles FedCFamC2F court code", () => {
    const result = parseCitation("[2022] FedCFamC2F 786");
    expect(result?.neutralCitation).toBe("[2022] FedCFamC2F 786");
  });

  it("returns null for non-citation text", () => {
    expect(parseCitation("hello world")).toBeNull();
  });
});

describe("formatAGLC4", () => {
  it("formats neutral citation only", () => {
    const result = formatAGLC4({
      title: "Mabo v Queensland (No 2)",
      neutralCitation: "[1992] HCA 23",
    });
    expect(result).toBe("Mabo v Queensland (No 2) [1992] HCA 23");
  });

  it("formats combined citation", () => {
    const result = formatAGLC4({
      title: "Mabo v Queensland (No 2)",
      neutralCitation: "[1992] HCA 23",
      reportedCitation: "(1992) 175 CLR 1",
    });
    expect(result).toBe("Mabo v Queensland (No 2) [1992] HCA 23, (1992) 175 CLR 1");
  });

  it("appends paragraph pinpoint", () => {
    const result = formatAGLC4({
      title: "Mabo v Queensland (No 2)",
      neutralCitation: "[1992] HCA 23",
      pinpoint: "[20]",
    });
    expect(result).toBe("Mabo v Queensland (No 2) [1992] HCA 23 at [20]");
  });

  it("formats reported citation only", () => {
    const result = formatAGLC4({
      title: "Mabo v Queensland (No 2)",
      reportedCitation: "(1992) 175 CLR 1",
    });
    expect(result).toBe("Mabo v Queensland (No 2) (1992) 175 CLR 1");
  });
});

describe("isValidNeutralCitation", () => {
  it("returns true for valid HCA citation", () => {
    expect(isValidNeutralCitation("[2024] HCA 26")).toBe(true);
  });
  it("returns true for FedCFamC2F", () => {
    expect(isValidNeutralCitation("[2022] FedCFamC2F 786")).toBe(true);
  });
  it("returns false for missing brackets", () => {
    expect(isValidNeutralCitation("HCA 26")).toBe(false);
  });
  it("returns false for empty string", () => {
    expect(isValidNeutralCitation("")).toBe(false);
  });
});

describe("isValidReportedCitation", () => {
  it("returns true for valid reported citation", () => {
    expect(isValidReportedCitation("(1992) 175 CLR 1")).toBe(true);
  });
  it("returns false for plain text", () => {
    expect(isValidReportedCitation("not a citation")).toBe(false);
  });
});

describe("shortFormAGLC4", () => {
  it("returns title with pinpoint", () => {
    expect(shortFormAGLC4("Mabo", "[20]")).toBe("Mabo [20]");
  });
  it("returns title without pinpoint", () => {
    expect(shortFormAGLC4("Mabo")).toBe("Mabo");
  });
});

describe("normaliseCitation", () => {
  it("normalises whitespace in citation", () => {
    expect(normaliseCitation("[1992]  HCA  23")).toBe("[1992] HCA 23");
  });
  it("trims surrounding whitespace", () => {
    expect(normaliseCitation("  (1992) 175 CLR 1  ")).toBe("(1992) 175 CLR 1");
  });
});

describe("validateCitation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns valid=true for known neutral citation (mocked 200)", async () => {
    vi.spyOn(axios, "head").mockResolvedValueOnce({ status: 200 });
    const result = await validateCitation("[1992] HCA 23");
    expect(result.valid).toBe(true);
    expect(result.austliiUrl).toContain("HCA");
  });

  it("returns valid=false for unknown court code", async () => {
    const result = await validateCitation("[2024] UNKNOWN 1");
    expect(result.valid).toBe(false);
  });

  it("returns valid=false on 404 (mocked)", async () => {
    vi.spyOn(axios, "head").mockRejectedValueOnce({ response: { status: 404 } });
    const result = await validateCitation("[9999] HCA 999");
    expect(result.valid).toBe(false);
  });

  describe.skip("integration - live network", () => {
    it("validates [1992] HCA 23 against live AustLII", async () => {
      const result = await validateCitation("[1992] HCA 23");
      expect(result.valid).toBe(true);
      expect(result.austliiUrl).toContain("austlii.edu.au");
    }, 30_000);
  });
});

describe("generatePinpoint", () => {
  const paragraphs: ParagraphBlock[] = [
    { number: 1, text: "Background facts." },
    { number: 2, text: "The duty of care applied here." },
    { number: 3, text: "Conclusion and orders." },
  ];

  it("finds paragraph by number", () => {
    const result = generatePinpoint(paragraphs, { paragraphNumber: 2 });
    expect(result?.paragraphNumber).toBe(2);
    expect(result?.pinpointString).toBe("at [2]");
  });

  it("finds paragraph by phrase", () => {
    const result = generatePinpoint(paragraphs, { phrase: "duty of care" });
    expect(result?.paragraphNumber).toBe(2);
    expect(result?.pinpointString).toBe("at [2]");
  });

  it("returns null when phrase not found", () => {
    expect(generatePinpoint(paragraphs, { phrase: "estoppel" })).toBeNull();
  });

  it("returns null when paragraph number not found", () => {
    expect(generatePinpoint(paragraphs, { paragraphNumber: 99 })).toBeNull();
  });

  it("includes page pinpoint when pageNumber available", () => {
    const paras: ParagraphBlock[] = [{ number: 1, text: "facts", pageNumber: 456 }];
    const result = generatePinpoint(paras, { paragraphNumber: 1 });
    expect(result?.pageString).toBe("at 456");
  });

  it("phrase match is case-insensitive", () => {
    const result = generatePinpoint(paragraphs, { phrase: "DUTY OF CARE" });
    expect(result?.paragraphNumber).toBe(2);
  });
});
