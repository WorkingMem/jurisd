/**
 * Smoke tests for jade.io search functions.
 * Network tests require JURISD_RUN_LIVE_JADE=1; pure-function tests always run.
 */
import { describe, it, expect } from "vitest";
import {
  searchJade,
  resolveArticleFromUrl,
  buildCitationLookupUrl,
  isJadeUrl,
  extractArticleId,
} from "../../services/jade.js";

const RUN_LIVE_JADE = process.env.JURISD_RUN_LIVE_JADE === "1";

describe("searchJade", () => {
  it.skipIf(!RUN_LIVE_JADE)(
    "returns results for 'native title' when session cookie is configured",
    async () => {
      if (!process.env.JADE_SESSION_COOKIE) {
        console.warn("JADE_SESSION_COOKIE not set — skipping live jade search smoke test");
        return;
      }
      const results = await searchJade("native title", { type: "case", limit: 3 });
      expect(Array.isArray(results)).toBe(true);
    },
    30_000,
  );

  it("returns empty array when no session cookie is set (pure function path)", async () => {
    const originalCookie = process.env.JADE_SESSION_COOKIE;
    delete process.env.JADE_SESSION_COOKIE;
    try {
      const { config } = await import("../../config.js");
      const savedCookie = config.jade.sessionCookie;
      (config.jade as { sessionCookie: string | undefined }).sessionCookie = undefined;
      const results = await searchJade("test", { type: "case" });
      expect(results).toEqual([]);
      (config.jade as { sessionCookie: string | undefined }).sessionCookie = savedCookie;
    } finally {
      if (originalCookie !== undefined) {
        process.env.JADE_SESSION_COOKIE = originalCookie;
      }
    }
  });
});

describe("resolveArticleFromUrl", () => {
  it.skipIf(!RUN_LIVE_JADE)(
    "resolves Mabo v Queensland article from jade.io URL",
    async () => {
      const article = await resolveArticleFromUrl("https://jade.io/article/67683");
      expect(article).toBeDefined();
      expect(article?.id).toBe(67683);
      expect(article?.accessible).toBe(true);
      expect(article?.title).toBeTruthy();
    },
    30_000,
  );

  it("returns undefined for URL with no article ID (pure function)", async () => {
    const result = await resolveArticleFromUrl("https://jade.io/search?q=test");
    expect(result).toBeUndefined();
  });
});

describe("buildCitationLookupUrl", () => {
  it("builds a jade.io search URL from a citation string (pure function)", () => {
    const url = buildCitationLookupUrl("[1992] HCA 23");
    expect(url).toContain("jade.io");
    expect(url).toContain("%5B1992%5D");
    expect(url).toContain("HCA");
  });
});

describe("isJadeUrl", () => {
  it("correctly identifies jade.io URLs (pure function)", () => {
    expect(isJadeUrl("https://jade.io/article/67683")).toBe(true);
    expect(isJadeUrl("https://www.austlii.edu.au/cases/cth/HCA/1992/23.html")).toBe(false);
    expect(isJadeUrl("not-a-url")).toBe(false);
  });
});

describe("extractArticleId", () => {
  it("extracts article IDs from jade.io URL patterns (pure function)", () => {
    expect(extractArticleId("https://jade.io/article/67683")).toBe(67683);
    expect(extractArticleId("https://jade.io/j/?a=outline&id=12345")).toBe(12345);
    expect(extractArticleId("https://jade.io/search?q=mabo")).toBeUndefined();
  });
});
