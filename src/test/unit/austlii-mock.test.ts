import { describe, it, expect, vi, beforeEach } from "vitest";
import { __clearTavilyFallbackStateForTests, searchAustLii } from "../../services/austlii.js";
import { AUSTLII_SEARCH_HTML, AUSTLII_CLOUDFLARE_CHALLENGE_HTML } from "../fixtures/index.js";
import { CloudflareBlockedError, AustLiiError } from "../../errors.js";

// Mock the TRANSPORT SEAM rather than axios. searchAustLii routes its request
// through fetcherForUrl(); we capture the URL and headers it builds and return
// fixture bytes so the parse path runs deterministically with no network.
const { getMock, fetcherForUrlMock, fetchDocumentTextMock, tavilyThrottleMock } = vi.hoisted(() => {
  const getMock = vi.fn();
  const fetcherForUrlMock = vi.fn(() => ({ get: getMock }));
  const fetchDocumentTextMock = vi.fn();
  const tavilyThrottleMock = vi.fn().mockResolvedValue(undefined);
  return { getMock, fetcherForUrlMock, fetchDocumentTextMock, tavilyThrottleMock };
});

vi.mock("../../services/transport.js", () => ({
  fetcherForUrl: fetcherForUrlMock,
}));

vi.mock("../../services/fetcher.js", () => ({
  fetchDocumentText: fetchDocumentTextMock,
}));

vi.mock("../../utils/rate-limiter.js", () => ({
  austliiRateLimiter: { throttle: vi.fn().mockResolvedValue(undefined) },
  tavilyRateLimiter: { throttle: tavilyThrottleMock },
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
    tavily: {
      apiKey: undefined as string | undefined,
      austliiFallbackEnabled: false,
      searchDepth: "advanced" as const,
      timeout: 5000,
      maxResults: 10,
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

function verifiedDocument(
  url = "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
) {
  return {
    text: "Mabo v Queensland (No 2) [1992] HCA 23\n(1992) 175 CLR 1\nVerified AustLII source text.",
    contentType: "text/html",
    sourceUrl: url,
    metadata: { contentLength: "99" },
  };
}

describe("searchAustLii (transport seam)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    __clearTavilyFallbackStateForTests();
    getMock.mockResolvedValue(okResponse(AUSTLII_SEARCH_HTML));
    fetchDocumentTextMock.mockResolvedValue(verifiedDocument());
    vi.unstubAllGlobals();
    const { config } = await import("../../config.js");
    config.austlii.searchBase = "https://www.austlii.edu.au/cgi-bin/sinosrch.cgi";
    config.austlii.cfClearance = undefined;
    config.tavily.apiKey = undefined;
    config.tavily.austliiFallbackEnabled = false;
    config.tavily.searchDepth = "advanced";
    config.tavily.timeout = 5000;
    config.tavily.maxResults = 10;
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

  it("rejects non-AustLII search bases before sending a clearance cookie", async () => {
    const { config } = await import("../../config.js");
    config.austlii.searchBase = "https://example.test/cgi-bin/sinosrch.cgi";
    config.austlii.cfClearance = "secret-clearance";

    const err = await searchAustLii("negligence", { type: "case" }).catch((e) => e);

    expect(err).toBeInstanceOf(AustLiiError);
    expect((err as Error).message).toContain("not in permitted list");
    expect((err as Error).message).not.toContain("secret-clearance");
    expect(fetcherForUrlMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
  });

  it("retries the classic search endpoint after a CF challenge on the primary endpoint", async () => {
    getMock.mockResolvedValueOnce({
      status: 403,
      headers: { "content-type": "text/html" },
      body: Buffer.from(AUSTLII_CLOUDFLARE_CHALLENGE_HTML, "utf-8"),
      finalUrl: "https://www.austlii.edu.au/cgi-bin/sinosrch.cgi",
      via: "impit" as const,
    });

    const results = await searchAustLii("negligence", { type: "case" });
    expect(results.length).toBeGreaterThan(0);
    expect(getMock).toHaveBeenCalledTimes(2);
    expect(String(getMock.mock.calls[0]?.[0] ?? "")).toContain("www.austlii.edu.au");
    expect(String(getMock.mock.calls[1]?.[0] ?? "")).toContain("classic.austlii.edu.au");
  });

  it("retries the classic search endpoint after a transport-level CF challenge", async () => {
    getMock
      .mockRejectedValueOnce(
        new CloudflareBlockedError("https://www.austlii.edu.au/cgi-bin/sinosrch.cgi", false),
      )
      .mockResolvedValueOnce(okResponse(AUSTLII_SEARCH_HTML));

    const results = await searchAustLii("negligence", { type: "case" });
    expect(results.length).toBeGreaterThan(0);
    expect(getMock).toHaveBeenCalledTimes(2);
    expect(String(getMock.mock.calls[0]?.[0] ?? "")).toContain("www.austlii.edu.au");
    expect(String(getMock.mock.calls[1]?.[0] ?? "")).toContain("classic.austlii.edu.au");
  });

  it("retries the classic search endpoint after a non-CF HTTP failure", async () => {
    getMock
      .mockResolvedValueOnce({
        status: 500,
        headers: { "content-type": "text/html" },
        body: Buffer.from("<html>server error</html>", "utf-8"),
        finalUrl: "https://www.austlii.edu.au/cgi-bin/sinosrch.cgi",
        via: "impit" as const,
      })
      .mockResolvedValueOnce(okResponse(AUSTLII_SEARCH_HTML));

    const results = await searchAustLii("negligence", { type: "case" });
    expect(results.length).toBeGreaterThan(0);
    expect(getMock).toHaveBeenCalledTimes(2);
    expect(String(getMock.mock.calls[0]?.[0] ?? "")).toContain("www.austlii.edu.au");
    expect(String(getMock.mock.calls[1]?.[0] ?? "")).toContain("classic.austlii.edu.au");
  });

  it("filters absolute external URLs from native AustLII search results", async () => {
    getMock.mockResolvedValue(
      okResponse(`
        <ol>
          <li data-count="1." class="multi">
            <a href="https://example.test/au/cases/cth/HCA/1992/23.html">External [1992] HCA 23</a>
            <p class="meta"><a>High Court of Australia</a> 3 June 1992</p>
          </li>
          <li data-count="2." class="multi">
            <a href="https://www6.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html?query=mabo&mask_path=au/cases/cth">Mabo v Queensland (No 2) [1992] HCA 23</a>
            <p class="meta"><a>High Court of Australia</a> 3 June 1992</p>
          </li>
        </ol>
      `),
    );

    const results = await searchAustLii("[1992] HCA 23", {
      type: "case",
      jurisdiction: "cth",
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.url).toBe(
      "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
    );
    expect(results[0]!.title).toContain("Mabo");
  });

  it("throws a typed CloudflareBlockedError when all search endpoints are challenged", async () => {
    getMock
      .mockResolvedValueOnce({
        status: 403,
        headers: { "content-type": "text/html" },
        body: Buffer.from(AUSTLII_CLOUDFLARE_CHALLENGE_HTML, "utf-8"),
        finalUrl: "https://www.austlii.edu.au/cgi-bin/sinosrch.cgi",
        via: "impit" as const,
      })
      .mockResolvedValueOnce({
        status: 403,
        headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
        body: Buffer.from(AUSTLII_CLOUDFLARE_CHALLENGE_HTML, "utf-8"),
        finalUrl: "https://classic.austlii.edu.au/cgi-bin/sinosrch.cgi",
        via: "impit" as const,
      });

    const err = await searchAustLii("negligence", { type: "case" }).catch((e) => e);
    expect(err).toBeInstanceOf(CloudflareBlockedError);
    expect(err).toBeInstanceOf(AustLiiError);
    expect((err as CloudflareBlockedError).statusCode).toBe(403);
    expect(getMock).toHaveBeenCalledTimes(2);
    // The error message must never leak a cookie.
    expect((err as Error).message).not.toMatch(/cf_clearance|Cookie/);
  });

  it("uses Tavily as verified candidate discovery when all AustLII search endpoints are challenged", async () => {
    const { config } = await import("../../config.js");
    config.tavily.apiKey = "tvly-test";
    config.tavily.austliiFallbackEnabled = true;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: "[1992] HCA 23 - AustLII",
            url: "https://www6.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
            content: "Unverified Tavily snippet that must not be returned",
            score: 0.79,
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    getMock.mockResolvedValue({
      status: 403,
      headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
      body: Buffer.from(AUSTLII_CLOUDFLARE_CHALLENGE_HTML, "utf-8"),
      finalUrl: "https://www.austlii.edu.au/cgi-bin/sinosrch.cgi",
      via: "impit" as const,
    });

    const results = await searchAustLii("[1992] HCA 23", {
      type: "case",
      jurisdiction: "cth",
      limit: 5,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("Mabo v Queensland (No 2) [1992] HCA 23");
    expect(results[0]!.url).toBe(
      "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
    );
    expect(results[0]!.neutralCitation).toBe("[1992] HCA 23");
    expect(results[0]!.discoverySource).toBe("tavily-fallback");
    expect(results[0]!.summary).toContain("verified by fetching the AustLII source");
    expect(results[0]!.summary).not.toContain("Unverified Tavily snippet");
    expect(fetchDocumentTextMock).toHaveBeenCalledWith(
      "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
    );
    expect(tavilyThrottleMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tvly-test" }),
      }),
    );
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as {
      query?: string;
      include_domains?: string[];
      max_results?: number;
    };
    expect(requestBody.query).toContain("[1992] HCA 23");
    expect(requestBody.include_domains).toEqual(["austlii.edu.au"]);
    expect(requestBody.max_results).toBe(10);
  });

  it("filters Tavily fallback case results to the requested Australian jurisdiction", async () => {
    const { config } = await import("../../config.js");
    config.tavily.apiKey = "tvly-test";
    config.tavily.austliiFallbackEnabled = true;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: "[2024] NSWSC 1 - AustLII",
            url: "https://www.austlii.edu.au/au/cases/nsw/NSWSC/2024/1.html",
            content: "Mismatched jurisdiction [2024] NSWSC 1",
          },
          {
            title: "[1992] HCA 23 - AustLII",
            url: "https://www6.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
            content: "Mabo v Queensland (No 2) [1992] HCA 23",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    getMock.mockResolvedValue({
      status: 403,
      headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
      body: Buffer.from(AUSTLII_CLOUDFLARE_CHALLENGE_HTML, "utf-8"),
      finalUrl: "https://www.austlii.edu.au/cgi-bin/sinosrch.cgi",
      via: "impit" as const,
    });

    const results = await searchAustLii("[1992] HCA 23", {
      type: "case",
      jurisdiction: "cth",
      limit: 5,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.jurisdiction).toBe("cth");
    expect(results[0]!.url).toContain("/au/cases/cth/");
    expect(fetchDocumentTextMock).toHaveBeenCalledTimes(1);
    expect(fetchDocumentTextMock).toHaveBeenCalledWith(
      "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
    );
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as {
      query?: string;
    };
    expect(requestBody.query).toContain("site:austlii.edu.au/au/cases/cth");
  });

  it("requests Tavily candidate headroom before applying the user result limit", async () => {
    const { config } = await import("../../config.js");
    config.tavily.apiKey = "tvly-test";
    config.tavily.austliiFallbackEnabled = true;
    config.tavily.maxResults = 10;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: "[2024] NSWSC 1 - AustLII",
            url: "https://www.austlii.edu.au/au/cases/nsw/NSWSC/2024/1.html",
            content: "Mismatched jurisdiction [2024] NSWSC 1",
          },
          {
            title: "[1992] HCA 23 - AustLII",
            url: "https://www6.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
            content: "Mabo v Queensland (No 2) [1992] HCA 23",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    getMock.mockResolvedValue({
      status: 403,
      headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
      body: Buffer.from(AUSTLII_CLOUDFLARE_CHALLENGE_HTML, "utf-8"),
      finalUrl: "https://www.austlii.edu.au/cgi-bin/sinosrch.cgi",
      via: "impit" as const,
    });

    const results = await searchAustLii("[1992] HCA 23", {
      type: "case",
      jurisdiction: "cth",
      limit: 1,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.neutralCitation).toBe("[1992] HCA 23");
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as {
      max_results?: number;
    };
    expect(requestBody.max_results).toBe(10);
  });

  it("filters Tavily fallback case results to New Zealand when requested", async () => {
    const { config } = await import("../../config.js");
    config.tavily.apiKey = "tvly-test";
    config.tavily.austliiFallbackEnabled = true;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: "[1992] HCA 23 - AustLII",
            url: "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
            content: "Mismatched Australian result [1992] HCA 23",
          },
          {
            title: "[2024] NZHC 2984 - AustLII",
            url: "https://www.austlii.edu.au/nz/cases/NZHC/2024/2984.html",
            content: "New Zealand result [2024] NZHC 2984",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    fetchDocumentTextMock.mockResolvedValue(
      verifiedDocument("https://www.austlii.edu.au/nz/cases/NZHC/2024/2984.html"),
    );
    getMock.mockResolvedValue({
      status: 403,
      headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
      body: Buffer.from(AUSTLII_CLOUDFLARE_CHALLENGE_HTML, "utf-8"),
      finalUrl: "https://www.austlii.edu.au/cgi-bin/sinosrch.cgi",
      via: "impit" as const,
    });

    const results = await searchAustLii("[2024] NZHC 2984", {
      type: "case",
      jurisdiction: "nz",
      limit: 5,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.jurisdiction).toBe("nz");
    expect(results[0]!.url).toContain("/nz/cases/");
    expect(results[0]!.neutralCitation).toBe("[2024] NZHC 2984");
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as {
      query?: string;
    };
    expect(requestBody.query).toContain("site:austlii.edu.au/nz/cases");
  });

  it("honours the configured Tavily candidate cap even if Tavily over-returns", async () => {
    const { config } = await import("../../config.js");
    config.tavily.apiKey = "tvly-test";
    config.tavily.austliiFallbackEnabled = true;
    config.tavily.maxResults = 1;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: "[1992] HCA 23 - AustLII",
            url: "https://www6.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
            content: "Mabo v Queensland (No 2) [1992] HCA 23",
          },
          {
            title: "[2024] HCA 1 - AustLII",
            url: "https://www.austlii.edu.au/au/cases/cth/HCA/2024/1.html",
            content: "Over-returned result",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    getMock.mockResolvedValue({
      status: 403,
      headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
      body: Buffer.from(AUSTLII_CLOUDFLARE_CHALLENGE_HTML, "utf-8"),
      finalUrl: "https://www.austlii.edu.au/cgi-bin/sinosrch.cgi",
      via: "impit" as const,
    });

    const results = await searchAustLii("[1992] HCA 23", {
      type: "case",
      jurisdiction: "cth",
      limit: 5,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.neutralCitation).toBe("[1992] HCA 23");
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as {
      max_results?: number;
    };
    expect(requestBody.max_results).toBe(1);
  });

  it("opens a visible Tavily fallback circuit after provider failures", async () => {
    const { config } = await import("../../config.js");
    config.tavily.apiKey = "tvly-test";
    config.tavily.austliiFallbackEnabled = true;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);
    getMock.mockResolvedValue({
      status: 403,
      headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
      body: Buffer.from(AUSTLII_CLOUDFLARE_CHALLENGE_HTML, "utf-8"),
      finalUrl: "https://www.austlii.edu.au/cgi-bin/sinosrch.cgi",
      via: "impit" as const,
    });

    const first = await searchAustLii("[1992] HCA 23", {
      type: "case",
      jurisdiction: "cth",
    }).catch((e) => e);
    expect(first).toBeInstanceOf(AustLiiError);
    expect((first as Error).message).toContain("Tavily fallback failed");

    fetchMock.mockClear();
    const second = await searchAustLii("[1992] HCA 23", {
      type: "case",
      jurisdiction: "cth",
    }).catch((e) => e);
    expect(second).toBeInstanceOf(AustLiiError);
    expect((second as Error).message).toContain("temporarily disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reuses bounded Tavily fallback cache entries without another provider call", async () => {
    const { config } = await import("../../config.js");
    config.tavily.apiKey = "tvly-test";
    config.tavily.austliiFallbackEnabled = true;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: "[1992] HCA 23 - AustLII",
            url: "https://www6.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
            content: "Mabo v Queensland (No 2) [1992] HCA 23",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    getMock.mockResolvedValue({
      status: 403,
      headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
      body: Buffer.from(AUSTLII_CLOUDFLARE_CHALLENGE_HTML, "utf-8"),
      finalUrl: "https://www.austlii.edu.au/cgi-bin/sinosrch.cgi",
      via: "impit" as const,
    });

    await searchAustLii("[1992] HCA 23", {
      type: "case",
      jurisdiction: "cth",
      limit: 5,
    });
    await searchAustLii("[1992] HCA 23", {
      type: "case",
      jurisdiction: "cth",
      limit: 5,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tavilyThrottleMock).toHaveBeenCalledTimes(1);
  });

  it("rejects overlong Tavily fallback queries before calling the provider", async () => {
    const { config } = await import("../../config.js");
    config.tavily.apiKey = "tvly-test";
    config.tavily.austliiFallbackEnabled = true;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    getMock.mockResolvedValue({
      status: 403,
      headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
      body: Buffer.from(AUSTLII_CLOUDFLARE_CHALLENGE_HTML, "utf-8"),
      finalUrl: "https://www.austlii.edu.au/cgi-bin/sinosrch.cgi",
      via: "impit" as const,
    });

    const err = await searchAustLii("x".repeat(501), {
      type: "case",
      jurisdiction: "cth",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AustLiiError);
    expect((err as Error).message).toContain("exceeds 500 characters");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not silently return empty results when Tavily fallback has no primary-source hits", async () => {
    const { config } = await import("../../config.js");
    config.tavily.apiKey = "tvly-test";
    config.tavily.austliiFallbackEnabled = true;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              title: "Commentary",
              url: "https://www.austlii.edu.au/au/journals/UQLawJl/2005/2.html",
              content: "mentions [1992] HCA 23",
            },
          ],
        }),
      }),
    );
    getMock.mockResolvedValue({
      status: 403,
      headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
      body: Buffer.from(AUSTLII_CLOUDFLARE_CHALLENGE_HTML, "utf-8"),
      finalUrl: "https://www.austlii.edu.au/cgi-bin/sinosrch.cgi",
      via: "impit" as const,
    });

    const err = await searchAustLii("[1992] HCA 23", {
      type: "case",
      jurisdiction: "cth",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CloudflareBlockedError);
  });

  it("wraps transport failures as a typed AustLiiError", async () => {
    getMock.mockRejectedValue(new Error("Network Error"));

    const err = await searchAustLii("negligence", { type: "case" }).catch((e) => e);
    expect(err).toBeInstanceOf(AustLiiError);
    expect((err as Error).message).toContain("AustLII search failed");
    expect(getMock).toHaveBeenCalledTimes(2);
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
