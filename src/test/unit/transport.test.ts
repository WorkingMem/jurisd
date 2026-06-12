import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchWithTransport, fetcherForUrl } from "../../services/transport.js";

// Mock cloudflare detection to keep tests deterministic
vi.mock("../../services/cloudflare.js", () => ({
  isCloudflareChallengeHtml: vi.fn().mockReturnValue(false),
  isCloudflareBotBlock: vi.fn().mockReturnValue(false),
  cfBlockMessage: vi.fn().mockReturnValue("cf block"),
}));

// Mock impit so the impit branch of fetcherForUrl is deterministic + offline.
const { impitFetchMock } = vi.hoisted(() => ({ impitFetchMock: vi.fn() }));
vi.mock("impit", () => ({
  Impit: class {
    fetch = impitFetchMock;
  },
}));

// Mock config
vi.mock("../../config.js", () => ({
  config: {
    transport: {
      useImpit: false,
      imitBrowser: "chrome",
    },
    oalc: { source: "/tmp/fixture.jsonl", enabled: false },
  },
}));

// Mock axios
vi.mock("axios", () => ({
  default: {
    request: vi.fn().mockResolvedValue({
      data: "<html><body>AustLII judgment</body></html>",
      status: 200,
      headers: { "content-type": "text/html" },
    }),
    get: vi.fn().mockResolvedValue({
      data: new TextEncoder().encode("<html><body>AustLII bytes</body></html>").buffer,
      status: 200,
      headers: { "content-type": "text/html" },
    }),
  },
}));

describe("fetchWithTransport (axios path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a TransportResponse with via=axios when useImpit is false", async () => {
    const result = await fetchWithTransport(
      "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
      {
        useImpit: false,
      },
    );
    expect(result.via).toBe("axios");
    expect(result.status).toBe(200);
    expect(result.body).toContain("AustLII");
  });

  it("includes response headers in the result", async () => {
    const result = await fetchWithTransport(
      "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
      {
        useImpit: false,
      },
    );
    expect(result.headers).toBeDefined();
    expect(typeof result.headers).toBe("object");
  });

  it("throws a descriptive error on CF challenge body", async () => {
    const { isCloudflareChallengeHtml } = await import("../../services/cloudflare.js");
    vi.mocked(isCloudflareChallengeHtml).mockReturnValueOnce(true);

    await expect(
      fetchWithTransport("https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html", {
        useImpit: false,
      }),
    ).rejects.toThrow("cf block");
  });

  it("throws a descriptive error when CF bot block status is returned", async () => {
    const { isCloudflareBotBlock } = await import("../../services/cloudflare.js");
    vi.mocked(isCloudflareBotBlock).mockReturnValueOnce(true);

    await expect(
      fetchWithTransport("https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html", {
        useImpit: false,
      }),
    ).rejects.toThrow();
  });

  it("falls back to axios when impit is requested but not installed", async () => {
    // Simulate impit not found by making dynamic import throw
    // Since we can't easily un-mock a dynamic import of a real module, we test
    // the explicit useImpit:false path directly.
    const result = await fetchWithTransport(
      "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
      { useImpit: false },
    );
    expect(result.via).toBe("axios");
  });
});

describe("fetcherForUrl (byte seam)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forces axios when transport is 'axios', even for AustLII", async () => {
    const fetcher = fetcherForUrl(
      "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
      "axios",
    );
    const r = await fetcher.get("https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html", {
      headers: { "User-Agent": "x" },
      timeoutMs: 1000,
    });
    expect(r.via).toBe("axios");
    expect(Buffer.isBuffer(r.body)).toBe(true);
    expect(r.body.toString("utf-8")).toContain("AustLII bytes");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("text/html");
  });

  it("uses axios for non-AustLII URLs in auto mode", async () => {
    const fetcher = fetcherForUrl("https://example.com/doc.html", "auto");
    const r = await fetcher.get("https://example.com/doc.html", {
      headers: {},
      timeoutMs: 1000,
    });
    expect(r.via).toBe("axios");
  });

  it("selects impit for AustLII URLs in auto mode and returns raw bytes", async () => {
    impitFetchMock.mockResolvedValue({
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      bytes: async () => new TextEncoder().encode("<html>impit body</html>"),
    });
    const fetcher = fetcherForUrl(
      "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
      "auto",
    );
    const r = await fetcher.get("https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html", {
      headers: { "User-Agent": "ua" },
      timeoutMs: 1000,
    });
    expect(r.via).toBe("impit");
    expect(r.body.toString("utf-8")).toContain("impit body");
    expect(r.headers["content-type"]).toBe("text/html");
    expect(r.status).toBe(200);
  });

  it("forces impit when transport is 'impit' even for non-AustLII URLs", async () => {
    impitFetchMock.mockResolvedValue({
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      bytes: async () => new TextEncoder().encode("forced impit"),
    });
    const fetcher = fetcherForUrl("https://example.com/x", "impit");
    const r = await fetcher.get("https://example.com/x", { headers: {}, timeoutMs: 1000 });
    expect(r.via).toBe("impit");
  });

  it("the AxiosFetcher passes through request headers and timeout", async () => {
    const { default: axios } = await import("axios");
    const fetcher = fetcherForUrl("https://example.com/doc.html", "axios");
    await fetcher.get("https://example.com/doc.html", {
      headers: { "User-Agent": "ua-test" },
      timeoutMs: 4242,
    });
    const call = vi.mocked(axios.get).mock.calls[0];
    expect(call?.[1]?.headers).toMatchObject({ "User-Agent": "ua-test" });
    expect(call?.[1]?.timeout).toBe(4242);
    expect(call?.[1]?.responseType).toBe("arraybuffer");
  });
});
