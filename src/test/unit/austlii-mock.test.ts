import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { searchAustLii } from "../../services/austlii.js";
import { AUSTLII_SEARCH_HTML } from "../fixtures/index.js";

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

  it("should throw on network failure", async () => {
    const axiosError = new Error("Network Error");
    mockedAxios.get.mockRejectedValue(axiosError);
    mockedAxios.isAxiosError.mockReturnValue(true);

    await expect(searchAustLii("negligence", { type: "case" })).rejects.toThrow(
      "AustLII search failed",
    );
  });

  it("should build correct search URL with jurisdiction filter", async () => {
    await searchAustLii("negligence", { type: "case", jurisdiction: "vic" });
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    const calledUrl = String(mockedAxios.get.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).toContain("mask_path=au%2Fcases%2Fvic");
  });

  it("filters out non-legislation URLs when searching for legislation", async () => {
    // Use HTML that includes a relative URL pointing to a /cases/ path (not /legis/)
    const legislationHtml = `
      <html><body>
        <ul><li data-count="1." class="multi">
          <a href="/au/legis/cth/consol_act/paa1988125.html">Privacy Act 1988 (Cth)</a>
          <p class="meta"><a>Commonwealth</a></p>
        </li>
        <li data-count="2." class="multi">
          <a href="/au/cases/cth/HCA/2024/1.html">Case that should be filtered</a>
          <p class="meta"><a>High Court</a></p>
        </li></ul>
      </body></html>`;
    mockedAxios.get.mockResolvedValueOnce({ data: legislationHtml, status: 200 });

    const results = await searchAustLii("Privacy Act", { type: "legislation" });
    for (const r of results) {
      expect(r.url).toContain("/legis/");
    }
  });

  it("processes relative URLs with query parameters correctly", async () => {
    // Simulate AustLII returning a relative URL with search-decoration query params
    const htmlWithRelativeUrl = `
      <html><body>
        <ul><li data-count="1." class="multi">
          <a href="/au/cases/cth/HCA/1992/23.html?stem=0&synonyms=0&query=mabo">Mabo v Queensland [1992] HCA 23</a>
          <p class="meta"><a>High Court</a></p>
        </li></ul>
      </body></html>`;
    mockedAxios.get.mockResolvedValueOnce({ data: htmlWithRelativeUrl, status: 200 });

    const results = await searchAustLii("mabo", { type: "case" });
    expect(results.length).toBeGreaterThan(0);
    // Search decoration params (stem, synonyms, query) should be stripped
    expect(results[0]!.url).not.toContain("stem=0");
    expect(results[0]!.url).not.toContain("synonyms=0");
    expect(results[0]!.url).toContain("austlii.edu.au");
  });

  it("rethrows non-AxiosError exceptions from network requests", async () => {
    const typeError = new TypeError("Failed to fetch");
    mockedAxios.get.mockRejectedValueOnce(typeError);
    mockedAxios.isAxiosError.mockReturnValue(false);

    await expect(searchAustLii("negligence", { type: "case" })).rejects.toThrow("Failed to fetch");
  });

  it("includes offset parameter in search URL when provided (line 270)", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: AUSTLII_SEARCH_HTML, status: 200 });

    await searchAustLii("negligence", { type: "case", offset: 10 });

    const calledUrl = String(mockedAxios.get.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).toContain("offset=10");
  });

  it("preserves non-decoration query params in relative result URLs (lines 315, 320)", async () => {
    const htmlWithCustomParam = `
      <html><body>
        <ul><li data-count="1." class="multi">
          <a href="/au/cases/cth/HCA/1992/23.html?stem=0&customparam=kept">Mabo v Queensland [1992] HCA 23</a>
          <p class="meta"><a>High Court</a></p>
        </li></ul>
      </body></html>`;
    mockedAxios.get.mockResolvedValueOnce({ data: htmlWithCustomParam, status: 200 });

    const results = await searchAustLii("mabo", { type: "case" });
    expect(results.length).toBeGreaterThan(0);
    // stem (decoration) should be stripped; customparam should be preserved
    expect(results[0]!.url).not.toContain("stem=0");
    expect(results[0]!.url).toContain("customparam=kept");
  });
});
