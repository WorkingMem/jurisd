import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { searchAustLii } from "../../services/austlii.js";
import { AUSTLII_SEARCH_HTML } from "../fixtures/index.js";
import { AustLiiError } from "../../errors.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

describe("searchAustLii (mocked)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAxios.get.mockResolvedValue({ data: AUSTLII_SEARCH_HTML, status: 200 });
    mockedAxios.isAxiosError.mockReturnValue(false);
  });

  it("should parse case results from HTML correctly", async () => {
    const results = await searchAustLii("negligence", { type: "case" });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.title).toBeTruthy();
      expect(r.url).toBeTruthy();
    }
  });

  it("should filter out journal articles (URLs with /journals/)", async () => {
    const results = await searchAustLii("negligence", { type: "case" });
    for (const r of results) {
      expect(r.url).not.toContain("/journals/");
    }
  });

  it("should filter out legislation results when searching for cases", async () => {
    const results = await searchAustLii("competition", { type: "case" });
    for (const r of results) {
      expect(r.url).toContain("/cases/");
      expect(r.url).not.toMatch(/\/legis\//);
    }
  });

  it("should extract neutral citations from titles", async () => {
    const results = await searchAustLii("Smith v Jones", { type: "case" });
    const withCitation = results.find((r) => r.neutralCitation);
    expect(withCitation).toBeDefined();
    expect(withCitation!.neutralCitation).toMatch(/\[\d{4}\]\s*[A-Z]+\s*\d+/);
  });

  it("should extract jurisdiction from URLs", async () => {
    const results = await searchAustLii("negligence", { type: "case" });
    const cthResult = results.find((r) => r.url.includes("/au/cases/cth/"));
    expect(cthResult).toBeDefined();
    expect(cthResult!.jurisdiction).toBe("cth");
  });

  it("should respect limit parameter", async () => {
    const results = await searchAustLii("negligence", { type: "case", limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it("should set source to 'austlii' for all results", async () => {
    const results = await searchAustLii("negligence", { type: "case" });
    for (const r of results) {
      expect(r.source).toBe("austlii");
    }
  });

  it("should throw AustLiiError on network failure", async () => {
    const axiosError = new Error("Network Error");
    mockedAxios.get.mockRejectedValue(axiosError);
    mockedAxios.isAxiosError.mockReturnValue(true);

    await expect(searchAustLii("negligence", { type: "case" })).rejects.toThrow(AustLiiError);
  });

  it("should build correct search URL with jurisdiction filter", async () => {
    await searchAustLii("negligence", { type: "case", jurisdiction: "vic" });
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    const calledUrl = String(mockedAxios.get.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).toContain("mask_path=au%2Fcases%2Fvic");
  });
});
