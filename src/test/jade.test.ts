import { describe, it, expect } from "vitest";
import {
  isJadeUrl,
  extractArticleId,
  buildArticleUrl,
  buildSearchUrl,
  parseTitleMetadata,
  getJurisdictionFromCourt,
  resolveArticle,
  resolveArticleFromUrl,
  articleToSearchResult,
  buildCitationLookupUrl,
  enrichWithJadeLinks,
  searchJade,
} from "../services/jade.js";
import type { SearchResult } from "../services/austlii.js";

// Skip live network tests in CI to prevent flaky failures
const describeLive = process.env.CI ? describe.skip : describe;

// Authenticated GWT-RPC tests — require JADE_SESSION_COOKIE env var
const describeAuth = process.env.CI || !process.env.JADE_SESSION_COOKIE ? describe.skip : describe;

// ── Unit tests (no network) ───────────────────────────────────────────

describe("jade.io URL utilities", () => {
  describe("isJadeUrl", () => {
    it("should recognise jade.io article URLs", () => {
      expect(isJadeUrl("https://jade.io/article/68901")).toBe(true);
    });

    it("should recognise jade.io subdomain URLs", () => {
      expect(isJadeUrl("https://www.jade.io/article/123")).toBe(true);
    });

    it("should recognise jade.io search URLs", () => {
      expect(isJadeUrl("https://jade.io/search/negligence")).toBe(true);
    });

    it("should reject non-jade URLs", () => {
      expect(isJadeUrl("https://www.austlii.edu.au/cases/cth/HCA/2025/1.html")).toBe(false);
      expect(isJadeUrl("https://example.com")).toBe(false);
    });

    it("should handle invalid URLs gracefully", () => {
      expect(isJadeUrl("not-a-url")).toBe(false);
      expect(isJadeUrl("")).toBe(false);
    });
  });

  describe("extractArticleId", () => {
    it("should extract ID from /article/{id} URLs", () => {
      expect(extractArticleId("https://jade.io/article/68901")).toBe(68901);
    });

    it("should extract ID from /article/{id}/path URLs", () => {
      expect(extractArticleId("https://jade.io/article/282240/some/path")).toBe(282240);
    });

    it("should extract ID from query parameter URLs", () => {
      expect(extractArticleId("https://jade.io/j/?a=outline&id=68901")).toBe(68901);
    });

    it("should return undefined for URLs without article IDs", () => {
      expect(extractArticleId("https://jade.io/search/negligence")).toBeUndefined();
      expect(extractArticleId("https://jade.io/")).toBeUndefined();
    });

    it("should return undefined for invalid URLs", () => {
      expect(extractArticleId("not-a-url")).toBeUndefined();
    });
  });

  describe("buildArticleUrl", () => {
    it("should build correct jade.io article URL", () => {
      expect(buildArticleUrl(68901)).toBe("https://jade.io/article/68901");
    });

    it("should handle large article IDs", () => {
      expect(buildArticleUrl(1098635)).toBe("https://jade.io/article/1098635");
    });
  });

  describe("buildSearchUrl", () => {
    it("should build a jade.io search URL", () => {
      expect(buildSearchUrl("negligence")).toBe("https://jade.io/search/negligence");
    });

    it("should encode special characters in query", () => {
      const url = buildSearchUrl("Mabo v Queensland");
      expect(url).toBe("https://jade.io/search/Mabo%20v%20Queensland");
    });

    it("should encode citation brackets", () => {
      const url = buildSearchUrl("[2008] NSWSC 323");
      expect(url).toContain("jade.io/search/");
      expect(url).toContain("2008");
      expect(url).toContain("NSWSC");
    });
  });
});

describe("jade.io title parsing", () => {
  describe("parseTitleMetadata", () => {
    it("should parse title with neutral citation", () => {
      const result = parseTitleMetadata(
        "Re Macquarie Private Capital A Ltd [2008] NSWSC 323 - BarNet Jade",
      );
      expect(result.title).toBe("Re Macquarie Private Capital A Ltd [2008] NSWSC 323");
      expect(result.neutralCitation).toBe("[2008] NSWSC 323");
      expect(result.year).toBe("2008");
      expect(result.jurisdiction).toBe("nsw");
    });

    it("should parse High Court case title", () => {
      const result = parseTitleMetadata("Mabo v Queensland (No 2) [1992] HCA 23 - BarNet Jade");
      expect(result.title).toBe("Mabo v Queensland (No 2) [1992] HCA 23");
      expect(result.neutralCitation).toBe("[1992] HCA 23");
      expect(result.year).toBe("1992");
      expect(result.jurisdiction).toBe("cth");
    });

    it("should parse Federal Court case title", () => {
      const result = parseTitleMetadata("Smith v Jones [2024] FCA 456 - BarNet Jade");
      expect(result.title).toBe("Smith v Jones [2024] FCA 456");
      expect(result.neutralCitation).toBe("[2024] FCA 456");
      expect(result.jurisdiction).toBe("cth");
    });

    it("should parse Victorian case title", () => {
      const result = parseTitleMetadata("Example Case [2023] VSC 100 - BarNet Jade");
      expect(result.jurisdiction).toBe("vic");
    });

    it("should parse Queensland case title", () => {
      const result = parseTitleMetadata("Test v State [2023] QSC 50 - BarNet Jade");
      expect(result.jurisdiction).toBe("qld");
    });

    it("should parse NZ case title", () => {
      const result = parseTitleMetadata(
        "JAMES HAYDON HUGHES AND GLADYS ANNE DAWSON [2024] NZHC 2984 - BarNet Jade",
      );
      expect(result.neutralCitation).toBe("[2024] NZHC 2984");
      expect(result.jurisdiction).toBe("nz");
      expect(result.year).toBe("2024");
    });

    it("should handle legislation title without citation", () => {
      const result = parseTitleMetadata("Long Service Leave Act 1992 (Vic) - BarNet Jade");
      expect(result.title).toBe("Long Service Leave Act 1992 (Vic)");
      expect(result.neutralCitation).toBeUndefined();
      expect(result.jurisdiction).toBeUndefined();
    });

    it("should handle title without BarNet Jade suffix", () => {
      const result = parseTitleMetadata("Some Case [2020] HCA 1");
      expect(result.title).toBe("Some Case [2020] HCA 1");
      expect(result.neutralCitation).toBe("[2020] HCA 1");
    });

    it("should parse Full Federal Court citations", () => {
      const result = parseTitleMetadata("Appeal Case [2023] FCAFC 99 - BarNet Jade");
      expect(result.neutralCitation).toBe("[2023] FCAFC 99");
      expect(result.jurisdiction).toBe("cth");
    });

    it("should parse SA, WA, TAS, NT, ACT courts", () => {
      const courts = [
        { input: "Case [2023] SASC 1 - BarNet Jade", jur: "sa" },
        { input: "Case [2023] WASC 1 - BarNet Jade", jur: "wa" },
        { input: "Case [2023] TASSC 1 - BarNet Jade", jur: "tas" },
        { input: "Case [2023] NTSC 1 - BarNet Jade", jur: "nt" },
        { input: "Case [2023] ACTSC 1 - BarNet Jade", jur: "act" },
      ];
      for (const { input, jur } of courts) {
        const result = parseTitleMetadata(input);
        expect(result.jurisdiction).toBe(jur);
      }
    });
  });

  describe("getJurisdictionFromCourt", () => {
    it("should map HCA to cth", () => {
      expect(getJurisdictionFromCourt("HCA")).toBe("cth");
    });

    it("should map NSWSC to nsw", () => {
      expect(getJurisdictionFromCourt("NSWSC")).toBe("nsw");
    });

    it("should handle lowercase input via normalization", () => {
      expect(getJurisdictionFromCourt("hca")).toBe("cth");
    });

    it("should return undefined for unknown courts", () => {
      expect(getJurisdictionFromCourt("UNKNOWN")).toBeUndefined();
    });
  });
});

describe("jade.io search result conversion", () => {
  it("should convert article to SearchResult", () => {
    const article = {
      id: 68901,
      title: "Re Macquarie Private Capital A Ltd [2008] NSWSC 323",
      neutralCitation: "[2008] NSWSC 323",
      jurisdiction: "nsw",
      year: "2008",
      url: "https://jade.io/article/68901",
      accessible: true,
    };

    const result = articleToSearchResult(article, "case");
    expect(result.title).toBe("Re Macquarie Private Capital A Ltd [2008] NSWSC 323");
    expect(result.neutralCitation).toBe("[2008] NSWSC 323");
    expect(result.url).toBe("https://jade.io/article/68901");
    expect(result.source).toBe("jade");
    expect(result.jurisdiction).toBe("nsw");
    expect(result.year).toBe("2008");
    expect(result.type).toBe("case");
  });

  it("should convert legislation article to SearchResult", () => {
    const article = {
      id: 282240,
      title: "Long Service Leave Act 1992 (Vic)",
      url: "https://jade.io/article/282240",
      accessible: true,
    };

    const result = articleToSearchResult(article, "legislation");
    expect(result.type).toBe("legislation");
    expect(result.source).toBe("jade");
    expect(result.neutralCitation).toBeUndefined();
  });
});

describe("jade.io cross-referencing", () => {
  it("should build citation lookup URL", () => {
    const url = buildCitationLookupUrl("[2008] NSWSC 323");
    expect(url).toContain("jade.io/search/");
    expect(url).toContain("2008");
  });

  it("should enrich AustLII results with jade links", () => {
    const results: SearchResult[] = [
      {
        title: "Test Case [2024] HCA 1",
        neutralCitation: "[2024] HCA 1",
        url: "https://www.austlii.edu.au/cases/cth/HCA/2024/1.html",
        source: "austlii",
        jurisdiction: "cth",
        year: "2024",
        type: "case",
      },
      {
        title: "Another Case",
        url: "https://www.austlii.edu.au/cases/cth/FCA/2024/2.html",
        source: "austlii",
        type: "case",
      },
    ];

    const enriched = enrichWithJadeLinks(results);
    expect(enriched).toHaveLength(2);

    // First result has citation → should get jadeUrl
    expect(enriched[0]?.jadeUrl).toBeDefined();
    expect(enriched[0]?.jadeUrl).toContain("jade.io/search/");

    // Second result has no citation → no jadeUrl
    expect(enriched[1]?.jadeUrl).toBeUndefined();
  });
});

describe("jade.io search", () => {
  it("returns case results when configured, otherwise degrades to an empty array", async () => {
    const results = await searchJade("negligence", {
      type: "case",
      limit: 5,
    });

    if (!process.env.JADE_SESSION_COOKIE) {
      expect(results).toEqual([]);
      return;
    }

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(5);
    for (const result of results) {
      expect(result.source).toBe("jade");
      expect(result.type).toBe("case");
      expect(result.title.length).toBeGreaterThan(0);
      expect(result.url).toMatch(/^https:\/\/jade\.io\//);
    }
  });

  it("returns legislation results when configured, otherwise degrades to an empty array", async () => {
    const results = await searchJade("corporations act", {
      type: "legislation",
    });

    if (!process.env.JADE_SESSION_COOKIE) {
      expect(results).toEqual([]);
      return;
    }

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.source).toBe("jade");
      expect(result.type).toBe("legislation");
      expect(result.title.length).toBeGreaterThan(0);
      expect(result.url).toMatch(/^https:\/\/jade\.io\//);
    }
  });
});

// ── Integration tests (hit live jade.io) ──────────────────────────────

describeLive("jade.io article resolution (live)", () => {
  /**
   * Test resolving a known accessible article.
   * Article 68901 = Re Macquarie Private Capital A Ltd [2008] NSWSC 323
   */
  it("should resolve metadata for a known case article", async () => {
    const article = await resolveArticle(68901);

    expect(article.id).toBe(68901);
    expect(article.url).toBe("https://jade.io/article/68901");
    expect(article.accessible).toBe(true);
    expect(article.title).toContain("Macquarie");
    expect(article.neutralCitation).toBe("[2008] NSWSC 323");
    expect(article.jurisdiction).toBe("nsw");
    expect(article.year).toBe("2008");
  }, 30000);

  /**
   * Test resolving a NZ case article.
   * Article 1106969 = JAMES HAYDON HUGHES... [2024] NZHC 2984
   */
  it("should resolve metadata for a NZ case article", async () => {
    const article = await resolveArticle(1106969);

    expect(article.id).toBe(1106969);
    expect(article.accessible).toBe(true);
    expect(article.neutralCitation).toBe("[2024] NZHC 2984");
    expect(article.jurisdiction).toBe("nz");
    expect(article.year).toBe("2024");
  }, 30000);

  /**
   * Test resolving a legislation article (no neutral citation expected).
   */
  it("should resolve legislation article without citation", async () => {
    const article = await resolveArticle(1098635);

    expect(article.id).toBe(1098635);
    expect(article.accessible).toBe(true);
    expect(article.title).toBeTruthy();
    // Legislation typically doesn't have neutral citations
    // (some do, some don't - don't assert either way)
  }, 30000);

  /**
   * Test resolving from a jade.io URL string.
   */
  it("should resolve article from URL", async () => {
    const article = await resolveArticleFromUrl("https://jade.io/article/68901");

    expect(article).toBeDefined();
    expect(article!.id).toBe(68901);
    expect(article!.accessible).toBe(true);
    expect(article!.title).toContain("Macquarie");
  }, 30000);

  /**
   * Test resolving from a query-parameter style URL.
   */
  it("should resolve article from query-parameter URL", async () => {
    const article = await resolveArticleFromUrl("https://jade.io/j/?a=outline&id=68901");

    expect(article).toBeDefined();
    expect(article!.id).toBe(68901);
    expect(article!.accessible).toBe(true);
  }, 30000);

  /**
   * Test that an inaccessible/nonexistent article is handled gracefully.
   * Article 397913 returns the generic jade.io title.
   */
  it("should handle inaccessible articles gracefully", async () => {
    const article = await resolveArticle(397913);

    expect(article.id).toBe(397913);
    expect(article.accessible).toBe(false);
    expect(article.url).toBe("https://jade.io/article/397913");
  }, 30000);

  /**
   * Test that resolveArticleFromUrl returns undefined for non-article URLs.
   */
  it("should return undefined for non-article URLs", async () => {
    const result = await resolveArticleFromUrl("https://jade.io/search/negligence");
    expect(result).toBeUndefined();
  });

  /**
   * Test converting resolved article to search result format.
   */
  it("should convert resolved article to SearchResult", async () => {
    const article = await resolveArticle(68901);
    const result = articleToSearchResult(article, "case");

    expect(result.source).toBe("jade");
    expect(result.type).toBe("case");
    expect(result.url).toBe("https://jade.io/article/68901");
    expect(result.neutralCitation).toBe("[2008] NSWSC 323");
    expect(result.title).toContain("Macquarie");
  }, 30000);
});

// ── Authenticated GWT-RPC content fetching (requires JADE_SESSION_COOKIE) ──

describeAuth("jade.io GWT-RPC content fetch (authenticated, live)", () => {
  /**
   * Article 67401 = Kosciusko Thredbo Pty Ltd v Commissioner of Taxation [1987] HCA 64
   * Verified via browser SPA interception - avd2Request returns full HTML.
   */
  it("returns substantial judgment HTML for a known article", async () => {
    const { fetchJadeArticleContent } = await import("../services/jade.js");
    const sessionCookie = process.env.JADE_SESSION_COOKIE!;

    const html = await fetchJadeArticleContent(67401, sessionCookie);

    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(1000);
    // Content should be HTML markup, not a GWT bootstrap shell
    expect(html).toMatch(/<div|<DIV|<p|<P/i);
    // Should NOT be the JS bootstrap shell
    expect(html).not.toContain("gwt.js");
    expect(html).not.toContain("BarNet Jade - Find recent");
  }, 30000);

  it("content contains case-specific anchors for article 67401", async () => {
    const { fetchJadeArticleContent } = await import("../services/jade.js");
    const html = await fetchJadeArticleContent(67401, process.env.JADE_SESSION_COOKIE!);

    // jade.io embeds article-specific anchor IDs like bnj_a_{articleId}_sr_{N}
    expect(html).toContain("bnj_a_67401");
  }, 30000);
});
