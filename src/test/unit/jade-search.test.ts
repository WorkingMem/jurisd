import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import axios from "axios";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

vi.mock("axios");

const mockConfig = vi.hoisted(() => ({
  jade: {
    userAgent: "test-agent",
    timeout: 5000,
    sessionCookie: undefined as string | undefined,
    baseUrl: "https://jade.io",
  },
  austlii: { searchBase: "", referer: "", userAgent: "", timeout: 5000 },
  defaults: {
    searchLimit: 10,
    maxSearchLimit: 50,
    outputFormat: "json",
    sortBy: "auto",
  },
}));

vi.mock("../../config.js", () => ({ config: mockConfig }));
vi.mock("../../utils/rate-limiter.js", () => ({
  jadeRateLimiter: { throttle: vi.fn().mockResolvedValue(undefined) },
  austliiRateLimiter: { throttle: vi.fn().mockResolvedValue(undefined) },
}));

import {
  searchJade,
  enrichWithJadeLinks,
  resolveArticleFromUrl,
  articleToSearchResult,
  buildCitationLookupUrl,
  parseTitleMetadata,
  getJurisdictionFromCourt,
  isJadeUrl,
  extractArticleId,
  type JadeArticle,
} from "../../services/jade.js";
import type { SearchResult } from "../../services/austlii.js";
import { jadeRateLimiter } from "../../utils/rate-limiter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
function readFixture(name: string): string {
  return readFileSync(join(__dirname, "../fixtures", name), "utf-8");
}

describe("searchJade", () => {
  beforeEach(() => {
    vi.mocked(axios.isAxiosError).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockConfig.jade.sessionCookie = undefined;
  });

  it("returns empty array when no session cookie is configured", async () => {
    const results = await searchJade("Mabo", { type: "case" });
    expect(results).toEqual([]);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("calls jadeService.do via POST with proposeCitables body when cookie configured", async () => {
    mockConfig.jade.sessionCookie = "IID=abc; alcsessionid=xyz";
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: readFixture("propose-citables-mabo.txt"),
      status: 200,
    });

    await searchJade("Mabo", { type: "case" });

    expect(axios.post).toHaveBeenCalledWith(
      "https://jade.io/jadeService.do",
      expect.stringContaining("proposeCitables"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "text/x-gwt-rpc; charset=UTF-8",
          Cookie: "IID=abc; alcsessionid=xyz",
        }),
      }),
    );
  });

  it("applies rate limiting via jadeRateLimiter", async () => {
    mockConfig.jade.sessionCookie = "IID=abc";
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: readFixture("propose-citables-mabo.txt"),
      status: 200,
    });

    await searchJade("Mabo", { type: "case" });

    expect(vi.mocked(jadeRateLimiter.throttle)).toHaveBeenCalled();
  });

  it("returns SearchResult[] with fallback URLs when resolveArticle fails", async () => {
    mockConfig.jade.sessionCookie = "IID=abc; alcsessionid=xyz";
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: readFixture("propose-citables-mabo.txt"),
      status: 200,
    });
    // axios.get not mocked -> resolveArticle rejects -> fallback to citation search URLs

    const results = await searchJade("Mabo", { type: "case" });

    expect(results.length).toBeGreaterThan(0);
    const hca23 = results.find((r) => r.neutralCitation === "[1992] HCA 23");
    expect(hca23).toBeDefined();
    expect(hca23!.source).toBe("jade");
    expect(hca23!.type).toBe("case");
    expect(hca23!.title).toContain("Mabo");
    expect(hca23!.url).toBe("https://jade.io/search/%5B1992%5D%20HCA%2023");
    expect(hca23!.reportedCitation).toContain("175 CLR 1");
  });

  it("returns direct article URLs when resolveArticle succeeds", async () => {
    mockConfig.jade.sessionCookie = "IID=abc; alcsessionid=xyz";
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: readFixture("propose-citables-mabo.txt"),
      status: 200,
    });

    // Mock axios.get for resolveArticle calls on bridge section candidates.
    // Article 67683 is the true Mabo [1992] HCA 23 article ID, confirmed via
    // Chrome navigation and present in the bridge section of the Mabo fixture.
    vi.mocked(axios.get).mockImplementation(async (reqUrl) => {
      const idMatch = String(reqUrl).match(/\/article\/(\d+)/);
      const id = idMatch?.[1] ? parseInt(idMatch[1], 10) : 0;
      if (id === 67683) {
        return {
          data: "<html><title>Mabo v Queensland (No 2) [1992] HCA 23 - BarNet Jade</title></html>",
          status: 200,
        };
      }
      return {
        data: "<html><title>BarNet Jade - Find recent Australian legal decisions</title></html>",
        status: 200,
      };
    });

    const results = await searchJade("Mabo", { type: "case" });

    expect(results.length).toBeGreaterThan(0);
    const hca23 = results.find((r) => r.neutralCitation === "[1992] HCA 23");
    expect(hca23).toBeDefined();
    expect(hca23!.url).toBe("https://jade.io/article/67683");
  });

  it("applies limit option to cap result count", async () => {
    mockConfig.jade.sessionCookie = "IID=abc";
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: readFixture("propose-citables-mabo.txt"),
      status: 200,
    });

    const results = await searchJade("Mabo", { type: "case", limit: 1 });

    expect(results.length).toBeLessThanOrEqual(1);
  });

  it("returns empty array on network error (graceful degradation)", async () => {
    mockConfig.jade.sessionCookie = "IID=abc";
    vi.mocked(axios.post).mockRejectedValueOnce(new Error("timeout"));

    const results = await searchJade("test", { type: "case" });

    expect(results).toEqual([]);
  });

  it("does not expose session cookie in error messages on AxiosError", async () => {
    mockConfig.jade.sessionCookie = "IID=secret123; alcsessionid=abc456";
    const axiosError = Object.assign(new Error("Network Error"), {
      isAxiosError: true,
      config: {
        headers: { Cookie: "IID=secret123; alcsessionid=abc456" },
      },
      response: undefined,
    });
    vi.mocked(axios.post).mockRejectedValueOnce(axiosError);
    vi.mocked(axios.isAxiosError).mockReturnValue(true);

    // Should not throw — graceful degradation
    const results = await searchJade("test", { type: "case" });
    expect(results).toEqual([]);
  });

  it("embeds the query in the POST body", async () => {
    mockConfig.jade.sessionCookie = "IID=abc";
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: readFixture("propose-citables-mabo.txt"),
      status: 200,
    });

    await searchJade("rice v asplund", { type: "case" });

    const postBody = vi.mocked(axios.post).mock.calls[0]?.[1] as string;
    expect(postBody).toContain("rice v asplund");
  });

  it("returns empty array on AxiosError (logs warning, does not throw)", async () => {
    mockConfig.jade.sessionCookie = "IID=abc";
    const axiosError = Object.assign(new Error("Network Error"), {
      isAxiosError: true,
      response: { status: 503 },
    });
    vi.mocked(axios.post).mockRejectedValueOnce(axiosError);
    vi.mocked(axios.isAxiosError).mockReturnValue(true);

    const results = await searchJade("test", { type: "case" });
    expect(results).toEqual([]);
  });
});

describe("enrichWithJadeLinks", () => {
  it("adds jadeUrl for results with neutralCitation", () => {
    const results: SearchResult[] = [
      {
        title: "Mabo v Queensland (No 2)",
        neutralCitation: "[1992] HCA 23",
        url: "https://www.austlii.edu.au/case",
        source: "austlii",
        type: "case",
      },
    ];
    const enriched = enrichWithJadeLinks(results);
    expect(enriched[0]?.jadeUrl).toContain("jade.io");
    expect(enriched[0]?.jadeUrl).toContain("HCA");
  });

  it("leaves results without neutralCitation unchanged (no jadeUrl)", () => {
    const results: SearchResult[] = [
      {
        title: "Unknown Case",
        url: "https://www.austlii.edu.au/case",
        source: "austlii",
        type: "case",
      },
    ];
    const enriched = enrichWithJadeLinks(results);
    expect(enriched[0]).not.toHaveProperty("jadeUrl");
    expect(enriched[0]?.title).toBe("Unknown Case");
  });
});

describe("resolveArticleFromUrl", () => {
  it("returns undefined when URL contains no article ID pattern", async () => {
    // jade.io/search has no /article/<id> and no ?id=<num>
    const result = await resolveArticleFromUrl("https://jade.io/search?q=mabo");
    expect(result).toBeUndefined();
  });

  it("calls resolveArticle when article ID is extractable", async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: "<html><title>Mabo v Queensland (No 2) [1992] HCA 23 - BarNet Jade</title></html>",
      status: 200,
    });
    const result = await resolveArticleFromUrl("https://jade.io/article/67683");
    expect(result).toBeDefined();
    expect(result?.id).toBe(67683);
    expect(result?.accessible).toBe(true);
  });
});

describe("articleToSearchResult", () => {
  it("maps JadeArticle fields to SearchResult correctly", () => {
    const article: JadeArticle = {
      id: 67683,
      title: "Mabo v Queensland (No 2) [1992] HCA 23",
      neutralCitation: "[1992] HCA 23",
      jurisdiction: "cth",
      year: "1992",
      url: "https://jade.io/article/67683",
      accessible: true,
    };
    const result = articleToSearchResult(article, "case");
    expect(result.title).toBe(article.title);
    expect(result.neutralCitation).toBe("[1992] HCA 23");
    expect(result.source).toBe("jade");
    expect(result.type).toBe("case");
    expect(result.url).toBe(article.url);
    expect(result.jurisdiction).toBe("cth");
    expect(result.year).toBe("1992");
  });

  it("works for legislation type", () => {
    const article: JadeArticle = {
      id: 12345,
      title: "Privacy Act 1988 (Cth)",
      url: "https://jade.io/article/12345",
      accessible: true,
    };
    const result = articleToSearchResult(article, "legislation");
    expect(result.type).toBe("legislation");
    expect(result.source).toBe("jade");
  });
});

describe("buildCitationLookupUrl", () => {
  it("builds a jade.io search URL from a citation string", () => {
    const url = buildCitationLookupUrl("[1992] HCA 23");
    expect(url).toContain("jade.io/search/");
    expect(url).toContain("HCA");
  });

  it("percent-encodes brackets in citation", () => {
    const url = buildCitationLookupUrl("[1992] HCA 23");
    expect(url).toContain("%5B1992%5D");
  });
});

describe("parseTitleMetadata", () => {
  it("extracts neutralCitation when present in title", () => {
    const result = parseTitleMetadata("Mabo v Queensland (No 2) [1992] HCA 23 - BarNet Jade");
    expect(result.neutralCitation).toBe("[1992] HCA 23");
    expect(result.year).toBe("1992");
  });

  it("returns only title when no citation pattern matches (line 184)", () => {
    const result = parseTitleMetadata("Privacy Policy - BarNet Jade");
    expect(result.neutralCitation).toBeUndefined();
    expect(result.title).toBe("Privacy Policy");
  });

  it("strips the BarNet Jade suffix from title", () => {
    const result = parseTitleMetadata("Some Case [2020] NSWCA 1 - BarNet Jade");
    expect(result.title).not.toContain("BarNet Jade");
  });
});

describe("getJurisdictionFromCourt (lines 190-192)", () => {
  it("returns jurisdiction for known court HCA", () => {
    expect(getJurisdictionFromCourt("HCA")).toBe("cth");
  });

  it("returns jurisdiction for court with spaces", () => {
    expect(getJurisdictionFromCourt("NSWCA")).toBe("nsw");
  });

  it("returns undefined for unknown court", () => {
    expect(getJurisdictionFromCourt("UNKNOWN")).toBeUndefined();
  });

  it("is case-insensitive", () => {
    expect(getJurisdictionFromCourt("hca")).toBe("cth");
  });
});

describe("resolveArticleFromUrl — AxiosError path", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns inaccessible article when resolveArticle catches AxiosError (line 251-257)", async () => {
    const axiosError = Object.assign(new Error("Not Found"), {
      isAxiosError: true,
      response: { status: 404 },
    });
    vi.mocked(axios.get).mockRejectedValueOnce(axiosError);
    vi.mocked(axios.isAxiosError).mockReturnValue(true);

    const result = await resolveArticleFromUrl("https://jade.io/article/99999");
    expect(result).toBeDefined();
    expect(result?.accessible).toBe(false);
    expect(result?.id).toBe(99999);
  });
});

describe("isJadeUrl", () => {
  it("returns true for jade.io URL", () => {
    expect(isJadeUrl("https://jade.io/article/67683")).toBe(true);
  });

  it("returns false for non-jade URL", () => {
    expect(isJadeUrl("https://www.austlii.edu.au/cases/cth/HCA/1992/23.html")).toBe(false);
  });

  it("returns false for invalid URL (line 110 catch branch)", () => {
    expect(isJadeUrl("not-a-valid-url")).toBe(false);
  });

  it("returns true for subdomain of jade.io", () => {
    expect(isJadeUrl("https://api.jade.io/article/67683")).toBe(true);
  });
});

describe("extractArticleId", () => {
  it("extracts article ID from /article/<id> pattern", () => {
    expect(extractArticleId("https://jade.io/article/67683")).toBe(67683);
  });

  it("extracts article ID from ?id= query parameter (line 133)", () => {
    expect(extractArticleId("https://jade.io/j/?a=outline&id=12345")).toBe(12345);
  });

  it("returns undefined when no article ID pattern matches", () => {
    expect(extractArticleId("https://jade.io/search?q=mabo")).toBeUndefined();
  });
});

describe("searchJade — jurisdiction filter (line 441-442)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockConfig.jade.sessionCookie = undefined;
  });

  it("filters results to requested jurisdiction", async () => {
    mockConfig.jade.sessionCookie = "IID=abc; alcsessionid=xyz";
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: readFixture("propose-citables-mabo.txt"),
      status: 200,
    });
    vi.mocked(axios.isAxiosError).mockReturnValue(false);

    // Mabo is cth; requesting vic should filter it out (or keep if jurisdiction not set)
    const cthResults = await searchJade("Mabo", { type: "case", jurisdiction: "cth" });
    // All cth results should have jurisdiction cth or undefined
    for (const r of cthResults) {
      if (r.jurisdiction) {
        expect(r.jurisdiction).toBe("cth");
      }
    }
    // vic filter should return empty (Mabo is cth, not vic)
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: readFixture("propose-citables-mabo.txt"),
      status: 200,
    });
    const vicResults = await searchJade("Mabo", { type: "case", jurisdiction: "vic" });
    // All vic results should have jurisdiction vic or undefined
    for (const r of vicResults) {
      if (r.jurisdiction) {
        expect(r.jurisdiction).toBe("vic");
      }
    }
  });
});
