/**
 * Smoke tests for AustLII search functions.
 * These hit the live AustLII service and are skipped in CI (CI env var set).
 */
import { describe, it, expect } from "vitest";
import { searchAustLii, calculateAuthorityScore, isCaseNameQuery } from "../../services/austlii.js";
import type { SearchResult } from "../../services/austlii.js";

const CI = !!process.env.CI;

describe("searchAustLii", () => {
  it.skipIf(CI)(
    "returns results for 'Mabo v Queensland'",
    async () => {
      const results = await searchAustLii("Mabo v Queensland", { type: "case", limit: 5 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty("title");
      expect(results[0]).toHaveProperty("url");
      expect(results.every((r) => r.source === "austlii")).toBe(true);
    },
    30_000,
  );

  it.skipIf(CI)(
    "returns HCA cases when jurisdiction is cth",
    async () => {
      const results = await searchAustLii("[1992] HCA 23", {
        type: "case",
        jurisdiction: "cth",
        limit: 5,
      });
      expect(results.length).toBeGreaterThan(0);
      const mabo = results.find((r) => r.title.includes("Mabo"));
      expect(mabo).toBeDefined();
    },
    30_000,
  );

  it.skipIf(CI)(
    "returns legislation results when type is legislation",
    async () => {
      const results = await searchAustLii("Privacy Act", {
        type: "legislation",
        jurisdiction: "cth",
        limit: 5,
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.type === "legislation")).toBe(true);
    },
    30_000,
  );
});

describe("calculateAuthorityScore", () => {
  it("returns higher score for HCA than FCA (pure function — no network)", () => {
    const hca: SearchResult = {
      url: "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
      title: "Mabo v Queensland (No 2)",
      source: "austlii",
      type: "case",
    };
    const fca: SearchResult = {
      url: "https://www.austlii.edu.au/au/cases/cth/FCA/2010/44.html",
      title: "Test Case",
      source: "austlii",
      type: "case",
    };
    expect(calculateAuthorityScore(hca)).toBeGreaterThan(calculateAuthorityScore(fca));
  });
});

describe("isCaseNameQuery", () => {
  it("identifies party-name queries correctly (pure function — no network)", () => {
    expect(isCaseNameQuery("Mabo v Queensland")).toBe(true);
    expect(isCaseNameQuery("native title rights")).toBe(false);
    expect(isCaseNameQuery("[1992] HCA 23")).toBe(true);
  });
});
