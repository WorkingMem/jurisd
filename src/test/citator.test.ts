import { describe, it, expect } from "vitest";
import { searchCitingCases } from "../services/jade.js";

// Authenticated citator tests -- require JADE_SESSION_COOKIE env var
const describeAuth =
  process.env.JURISD_RUN_LIVE_JADE === "1" && process.env.JADE_SESSION_COOKIE
    ? describe
    : describe.skip;

/**
 * Live citator integration tests
 *
 * These tests hit jade.io's LeftoverRemoteService.search via GWT-RPC.
 * They require a valid JADE_SESSION_COOKIE environment variable.
 *
 * The citator uses a two-phase flow:
 * 1. proposeCitables(caseName) to find the citable ID
 * 2. LeftoverRemoteService.search(citableId) to find citing cases
 */
describeAuth("jade.io citator (authenticated, live)", () => {
  /**
   * Mabo v Queensland (No 2) [1992] HCA 23
   * One of the most-cited cases in Australian law (695+ citing cases as of 2026-03-03).
   */
  it("should find citing cases for Mabo v Queensland (No 2)", async () => {
    const { results, totalCount } = await searchCitingCases("Mabo v Queensland (No 2)");

    // Should have a substantial total count
    expect(totalCount).toBeGreaterThanOrEqual(500);

    // Should return a meaningful sample
    expect(results.length).toBeGreaterThan(10);

    // All results should have the required fields
    for (const r of results) {
      expect(r.neutralCitation).toMatch(/^\[\d{4}\]\s+[A-Z]/);
      expect(r.caseName).toBeTruthy();
      expect(r.jadeUrl).toMatch(/^https:\/\/jade\.io\//);
    }

    // Known citing case: Stuart v South Australia [2025] HCA 12
    const stuart = results.find((r) => r.neutralCitation === "[2025] HCA 12");
    if (stuart) {
      expect(stuart.caseName).toContain("Stuart");
      expect(stuart.jadeUrl).toBe("https://jade.io/article/1127773");
    }
  }, 60000);

  /**
   * Donoghue v Stevenson [1932] UKHL 100 (via jade.io)
   * Foundational tort law case -- should have many citing cases.
   */
  it("should find citing cases for Donoghue v Stevenson", async () => {
    const { results, totalCount } = await searchCitingCases("Donoghue v Stevenson");

    // Should find citing cases (jade.io tracks AU citations of UK cases)
    expect(totalCount).toBeGreaterThan(0);
    expect(results.length).toBeGreaterThan(0);

    // Validate result structure
    for (const r of results) {
      expect(r.neutralCitation).toMatch(/^\[\d{4}\]\s+[A-Z]/);
      expect(r.caseName).toBeTruthy();
      expect(r.jadeUrl).toMatch(/^https:\/\/jade\.io\//);
    }
  }, 60000);

  /**
   * Test a case that may have few or no citing cases.
   * Uses a relatively obscure case name.
   */
  it("should handle cases with few or no citing cases gracefully", async () => {
    const { results, totalCount } = await searchCitingCases(
      "Kozarov v State of Victoria [2020] VSC 78",
    );

    // May have 0 or a small number of citations -- just ensure it doesn't throw
    expect(totalCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(results)).toBe(true);
  }, 60000);
});

/**
 * Recursive citation chain discovery
 *
 * Starting from a well-known case, follow the citation chain:
 * Case A is cited by Cases B, C, D...
 * Pick Case B, find what cites Case B...
 * Continue for N levels (bounded to avoid excessive API calls).
 *
 * This validates that the citator can chain queries and that results
 * from one query can be used as input to the next.
 */
describeAuth("citation chain discovery (authenticated, live)", () => {
  it("should follow a 2-level citation chain from Mabo", async () => {
    // Level 0: Find cases citing Mabo
    const level0 = await searchCitingCases("Mabo v Queensland (No 2)");
    expect(level0.totalCount).toBeGreaterThan(0);
    expect(level0.results.length).toBeGreaterThan(0);

    console.log(
      `Level 0: Mabo is cited by ${level0.totalCount} cases (${level0.results.length} returned)`,
    );

    // Pick a citing case that is likely to also be well-cited.
    // Prefer older HCA cases (pre-2024) as they have had time to accumulate citations.
    const olderHcaCases = level0.results.filter((r) => {
      const yearMatch = r.neutralCitation.match(/^\[(\d{4})\]/);
      return r.neutralCitation.includes("HCA") && yearMatch && parseInt(yearMatch[1]!) < 2024;
    });
    const level1Target = olderHcaCases.length > 0 ? olderHcaCases[0]! : level0.results[0]!;

    // Use caseName + neutralCitation for more precise proposeCitables matching
    const level1Query = `${level1Target.caseName} ${level1Target.neutralCitation}`;
    console.log(`Level 1 target: ${level1Query}`);

    // Level 1: Find cases citing the Level 1 target
    const level1 = await searchCitingCases(level1Query);
    expect(level1.totalCount).toBeGreaterThanOrEqual(0);

    console.log(
      `Level 1: ${level1Target.caseName} is cited by ${level1.totalCount} cases (${level1.results.length} returned)`,
    );

    if (level1.results.length > 0) {
      // Pick another case for level 2
      const level2Target = level1.results[0]!;
      const level2Query = `${level2Target.caseName} ${level2Target.neutralCitation}`;

      console.log(`Level 2 target: ${level2Query}`);

      // Level 2: Find cases citing the Level 2 target
      const level2 = await searchCitingCases(level2Query);
      expect(level2.totalCount).toBeGreaterThanOrEqual(0);

      console.log(
        `Level 2: ${level2Target.caseName} is cited by ${level2.totalCount} cases (${level2.results.length} returned)`,
      );

      // Validate the chain results
      for (const r of level2.results) {
        expect(r.neutralCitation).toMatch(/^\[\d{4}\]\s+[A-Z]/);
        expect(r.caseName).toBeTruthy();
        expect(r.jadeUrl).toMatch(/^https:\/\/jade\.io\//);
      }
    }
  }, 180000);

  it("should build a citation breadth map for a significant case", async () => {
    // Use Rogers v Whitaker with full citation for precise matching
    const root = await searchCitingCases("Rogers v Whitaker [1992] HCA 58");
    expect(root.totalCount).toBeGreaterThan(100);

    console.log(
      `Root: Rogers v Whitaker [1992] HCA 58 is cited by ${root.totalCount} cases (${root.results.length} returned)`,
    );

    // For each of the first 3 citing cases, check how many cases cite them
    // Use caseName + citation for better proposeCitables matching
    const breadthMap: Array<{
      caseName: string;
      citation: string;
      citedByCount: number;
    }> = [];

    const targets = root.results.slice(0, 3);
    for (const target of targets) {
      const query = `${target.caseName} ${target.neutralCitation}`;
      const child = await searchCitingCases(query);
      breadthMap.push({
        caseName: target.caseName,
        citation: target.neutralCitation,
        citedByCount: child.totalCount,
      });

      console.log(
        `  ${target.caseName} ${target.neutralCitation} -> cited by ${child.totalCount} cases`,
      );
    }

    // Log summary
    const citedCases = breadthMap.filter((b) => b.citedByCount > 0);
    console.log(`${citedCases.length} of ${breadthMap.length} citing cases are themselves cited`);
  }, 300000);
});
