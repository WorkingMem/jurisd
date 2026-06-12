import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchAustLii } from "../../services/austlii.js";
import { AUSTLII_SEARCH_HTML, AUSTLII_CLOUDFLARE_CHALLENGE_HTML } from "../fixtures/index.js";
import { CloudflareBlockedError, AustLiiError } from "../../errors.js";

// Mock the TRANSPORT SEAM rather than axios. searchAustLii routes its request
// through fetcherForUrl(); we capture the URL and headers it builds and return
// fixture bytes so the parse path runs deterministically with no network.
const { getMock, fetcherForUrlMock } = vi.hoisted(() => {
  const getMock = vi.fn();
  const fetcherForUrlMock = vi.fn(() => ({ get: getMock }));
  return { getMock, fetcherForUrlMock };
});

vi.mock("../../services/transport.js", () => ({
  fetcherForUrl: fetcherForUrlMock,
}));

// Config singleton would capture ambient AUSTLII_* / cf_clearance env at import.
// Stub it explicitly so the headers assertions are deterministic regardless of
// this machine's environment.
vi.mock("../../config.js", () => ({
  config: {
    austlii: {
      searchBase: "https://www.austlii.edu.au/cgi-bin/sinosrch.cgi",
      referer: "https://www.austlii.edu.au/forms/search1.html",
      userAgent: "test-austlii-ua/1.0",
      timeout: 5000,
      transport: "auto",
      classicRewrite: true,
      cfClearance: undefined as string | undefined,
      accept: "text/html",
      acceptLanguage: "en-AU,en;q=0.9",
    },
  },
}));

function okResponse(html: string) {
  return {
    status: 200,
    headers: { "content-type": "text/html" },
    body: Buffer.from(html, "utf-8"),
    finalUrl: "https://www.austlii.edu.au/cgi-bin/sinosrch.cgi",
    via: "axios" as const,
  };
}

describe("searchAustLii (transport seam)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockResolvedValue(okResponse(AUSTLII_SEARCH_HTML));
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

  it("wires AUSTLII_HEADERS from config.austlii (fixes v1 defect 2)", async () => {
    await searchAustLii("negligence", { type: "case" });
    expect(getMock).toHaveBeenCalledTimes(1);
    const opts = getMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(opts.headers["User-Agent"]).toBe("test-austlii-ua/1.0");
    expect(opts.headers["Accept"]).toBe("text/html");
    expect(opts.headers["Accept-Language"]).toBe("en-AU,en;q=0.9");
    expect(opts.headers["Referer"]).toBe("https://www.austlii.edu.au/forms/search1.html");
  });

  it("never includes a cookie header when cfClearance is unset", async () => {
    await searchAustLii("negligence", { type: "case" });
    const opts = getMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(opts.headers["Cookie"]).toBeUndefined();
  });

  it("throws a typed CloudflareBlockedError on a CF challenge response", async () => {
    getMock.mockResolvedValueOnce({
      status: 403,
      headers: { "content-type": "text/html" },
      body: Buffer.from(AUSTLII_CLOUDFLARE_CHALLENGE_HTML, "utf-8"),
      finalUrl: "https://www.austlii.edu.au/cgi-bin/sinosrch.cgi",
      via: "impit" as const,
    });

    const err = await searchAustLii("negligence", { type: "case" }).catch((e) => e);
    expect(err).toBeInstanceOf(CloudflareBlockedError);
    expect(err).toBeInstanceOf(AustLiiError);
    expect((err as CloudflareBlockedError).statusCode).toBe(403);
    // The error message must never leak a cookie.
    expect((err as Error).message).not.toMatch(/cf_clearance|Cookie/);
  });

  it("wraps transport failures as a typed AustLiiError", async () => {
    getMock.mockRejectedValueOnce(new Error("Network Error"));

    const err = await searchAustLii("negligence", { type: "case" }).catch((e) => e);
    expect(err).toBeInstanceOf(AustLiiError);
    expect((err as Error).message).toContain("AustLII search failed");
  });

  it("rethrows a typed AustLiiError without re-wrapping", async () => {
    getMock.mockRejectedValueOnce(new AustLiiError("already typed", 500));

    const err = await searchAustLii("negligence", { type: "case" }).catch((e) => e);
    expect(err).toBeInstanceOf(AustLiiError);
    expect((err as Error).message).toBe("already typed");
  });

  it("should build correct search URL with jurisdiction filter", async () => {
    await searchAustLii("negligence", { type: "case", jurisdiction: "vic" });
    expect(getMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(getMock.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).toContain("mask_path=au%2Fcases%2Fvic");
  });

  it("filters out non-legislation URLs when searching for legislation", async () => {
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
    getMock.mockResolvedValueOnce(okResponse(legislationHtml));

    const results = await searchAustLii("Privacy Act", { type: "legislation" });
    for (const r of results) {
      expect(r.url).toContain("/legis/");
    }
  });

  it("processes relative URLs with query parameters correctly", async () => {
    const htmlWithRelativeUrl = `
      <html><body>
        <ul><li data-count="1." class="multi">
          <a href="/au/cases/cth/HCA/1992/23.html?stem=0&synonyms=0&query=mabo">Mabo v Queensland [1992] HCA 23</a>
          <p class="meta"><a>High Court</a></p>
        </li></ul>
      </body></html>`;
    getMock.mockResolvedValueOnce(okResponse(htmlWithRelativeUrl));

    const results = await searchAustLii("mabo", { type: "case" });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.url).not.toContain("stem=0");
    expect(results[0]!.url).not.toContain("synonyms=0");
    expect(results[0]!.url).toContain("austlii.edu.au");
  });

  it("includes offset parameter in search URL when provided", async () => {
    getMock.mockResolvedValueOnce(okResponse(AUSTLII_SEARCH_HTML));

    await searchAustLii("negligence", { type: "case", offset: 10 });

    const calledUrl = String(getMock.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).toContain("offset=10");
  });

  it("preserves non-decoration query params in relative result URLs", async () => {
    const htmlWithCustomParam = `
      <html><body>
        <ul><li data-count="1." class="multi">
          <a href="/au/cases/cth/HCA/1992/23.html?stem=0&customparam=kept">Mabo v Queensland [1992] HCA 23</a>
          <p class="meta"><a>High Court</a></p>
        </li></ul>
      </body></html>`;
    getMock.mockResolvedValueOnce(okResponse(htmlWithCustomParam));

    const results = await searchAustLii("mabo", { type: "case" });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.url).not.toContain("stem=0");
    expect(results[0]!.url).toContain("customparam=kept");
  });
});
