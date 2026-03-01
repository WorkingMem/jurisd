import { describe, it, expect } from "vitest";
import {
  NEUTRAL_CITATION_PATTERN,
  REPORTED_CITATION_PATTERNS,
  SEARCH_METHODS,
  JURISDICTIONS,
  OCR_MIN_TEXT_LENGTH,
  DEFAULT_TIMEOUT_MS,
  LONG_TIMEOUT_MS,
  MAX_CONTENT_LENGTH,
} from "../../constants.js";

describe("Constants", () => {
  describe("NEUTRAL_CITATION_PATTERN", () => {
    it("should match standard neutral citations", () => {
      expect("[2024] HCA 26").toMatch(NEUTRAL_CITATION_PATTERN);
      expect("[1992] HCA 23").toMatch(NEUTRAL_CITATION_PATTERN);
      expect("[2025] NZSC 1").toMatch(NEUTRAL_CITATION_PATTERN);
    });

    it("should not match plain text", () => {
      expect("negligence duty of care").not.toMatch(NEUTRAL_CITATION_PATTERN);
    });

    it("matches FedCFamC2F neutral citation", () => {
      expect("[2022] FedCFamC2F 786".match(NEUTRAL_CITATION_PATTERN)).toBeTruthy();
    });

    it("matches FedCFamC1F neutral citation", () => {
      expect("[2023] FedCFamC1F 100".match(NEUTRAL_CITATION_PATTERN)).toBeTruthy();
    });
  });

  describe("REPORTED_CITATION_PATTERNS", () => {
    it("should match round-bracket reported citations", () => {
      expect("(2024) 350 ALR 123").toMatch(REPORTED_CITATION_PATTERNS[0]);
      expect("(1992) 175 CLR 1").toMatch(REPORTED_CITATION_PATTERNS[0]);
    });

    it("should match square-bracket reported citations", () => {
      expect("[2024] 1 NZLR 456").toMatch(REPORTED_CITATION_PATTERNS[1]);
    });
  });

  describe("SEARCH_METHODS", () => {
    it("should contain expected methods", () => {
      expect(SEARCH_METHODS.AUTO).toBe("auto");
      expect(SEARCH_METHODS.BOOLEAN).toBe("boolean");
      expect(SEARCH_METHODS.TITLE).toBe("title");
    });
  });

  describe("JURISDICTIONS", () => {
    it("should contain expected jurisdictions", () => {
      expect(JURISDICTIONS.COMMONWEALTH).toBe("cth");
      expect(JURISDICTIONS.NEW_ZEALAND).toBe("nz");
      expect(JURISDICTIONS.VICTORIA).toBe("vic");
    });
  });

  describe("Numeric constants", () => {
    it("should have sensible values", () => {
      expect(OCR_MIN_TEXT_LENGTH).toBe(100);
      expect(DEFAULT_TIMEOUT_MS).toBe(30_000);
      expect(LONG_TIMEOUT_MS).toBe(60_000);
      expect(MAX_CONTENT_LENGTH).toBe(50 * 1024 * 1024);
    });
  });
});
