import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import {
  parseCitation,
  formatAGLC4,
  formatPinpointRef,
  formatShortForm,
  isValidNeutralCitation,
  isValidReportedCitation,
  shortFormAGLC4,
  normaliseCitation,
  validateCitation,
  generatePinpoint,
  type Pinpoint,
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

  it("accepts uppercase-only reporter not in REPORTERS table (line 124)", () => {
    // "WLR" matches /^[A-Z]{2,8}$/ but is not in the REPORTERS constant
    const result = parseCitation("(2024) 1 WLR 100");
    expect(result?.reportedCitations[0]).toBe("(2024) 1 WLR 100");
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

  it("returns invalid with message when citation has no neutral citation pattern (line 258)", async () => {
    const result = await validateCitation("not a citation at all");
    expect(result.valid).toBe(false);
    expect(result.message).toContain("Not a recognised neutral citation format");
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

describe("formatPinpointRef", () => {
  it("formats paragraph pinpoint", () => {
    const p: Pinpoint = { type: "para", n: 20 };
    expect(formatPinpointRef(p)).toBe("[20]");
  });

  it("formats page pinpoint", () => {
    const p: Pinpoint = { type: "page", n: 401 };
    expect(formatPinpointRef(p)).toBe("401");
  });

  it("formats paragraph range", () => {
    const p: Pinpoint = { type: "paraRange", from: 64, to: 66 };
    expect(formatPinpointRef(p)).toBe("[64] to [66]");
  });

  it("formats page range", () => {
    const p: Pinpoint = { type: "pageRange", from: 401, to: 407 };
    expect(formatPinpointRef(p)).toBe("401 to 407");
  });

  it("formats legislation pinpoint", () => {
    const p: Pinpoint = { type: "legis", ref: "s 5(2)(a)" };
    expect(formatPinpointRef(p)).toBe("s 5(2)(a)");
  });
});

describe("formatShortForm", () => {
  it("plain short form with no pinpoint", () => {
    expect(formatShortForm({ title: "Mabo", mode: "short" })).toBe("Mabo");
  });

  it("plain short form with paragraph pinpoint", () => {
    expect(
      formatShortForm({ title: "Mabo", mode: "short", pinpoint: { type: "para", n: 20 } }),
    ).toBe("Mabo [20]");
  });

  it("Ibid with no pinpoint", () => {
    expect(formatShortForm({ title: "Mabo", mode: "ibid" })).toBe("Ibid");
  });

  it("Ibid with paragraph pinpoint", () => {
    expect(
      formatShortForm({ title: "Mabo", mode: "ibid", pinpoint: { type: "para", n: 20 } }),
    ).toBe("Ibid [20]");
  });

  it("subsequent reference with footnote number", () => {
    expect(formatShortForm({ title: "Mabo", mode: "subsequent", footnoteRef: 3 })).toBe(
      "Mabo (n 3)",
    );
  });

  it("subsequent reference with footnote number and pinpoint", () => {
    expect(
      formatShortForm({
        title: "Mabo",
        mode: "subsequent",
        footnoteRef: 3,
        pinpoint: { type: "para", n: 20 },
      }),
    ).toBe("Mabo (n 3) [20]");
  });

  it("subsequent reference without footnoteRef", () => {
    expect(formatShortForm({ title: "Mabo", mode: "subsequent" })).toBe("Mabo");
  });
});

describe("parseCitation – extended pinpoint shapes", () => {
  it("parses paragraph range pinpoint", () => {
    const result = parseCitation("Mabo [1992] HCA 23 at [64] to [66]");
    expect(result?.pinpoint).toBe("[64] to [66]");
  });

  it("parses page pinpoint", () => {
    const result = parseCitation("Bowrey (1992) 175 CLR 1 at 401");
    expect(result?.pinpoint).toBe("401");
  });

  it("parses page range pinpoint", () => {
    const result = parseCitation("Bowrey (1992) 175 CLR 1 at 401 to 407");
    expect(result?.pinpoint).toBe("401 to 407");
  });

  it("parses legislation pinpoint with section reference", () => {
    const result = parseCitation("[2022] HCA 5 at s 5(2)(a)");
    expect(result?.pinpoint).toBe("s 5(2)(a)");
  });
});

describe("parseCitation – mixed-case reporter fix", () => {
  it("parses FamLR reporter (mixed case)", () => {
    const result = parseCitation("(2010) 19 FamLR 1");
    expect(result?.reportedCitations[0]).toBe("(2010) 19 FamLR 1");
  });

  it("parses QdR reporter (mixed case)", () => {
    const result = parseCitation("[1992] 1 QdR 1");
    expect(result?.reportedCitations[0]).toBe("[1992] 1 QdR 1");
  });
});

describe("isValidReportedCitation – mixed-case reporters", () => {
  it("accepts FamLR", () => {
    expect(isValidReportedCitation("(2010) 19 FamLR 1")).toBe(true);
  });

  it("accepts QdR", () => {
    expect(isValidReportedCitation("[1992] 1 QdR 1")).toBe(true);
  });

  it("rejects unknown mixed-case abbreviation", () => {
    expect(isValidReportedCitation("(2010) 19 FooBar 1")).toBe(false);
  });
});
