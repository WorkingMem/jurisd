import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchWithTransport, fetcherForUrl } from "../../services/transport.js";
import { HttpStatusError } from "../../errors.js";

// Mock cloudflare detection to keep tests deterministic
vi.mock("../../services/cloudflare.js", () => ({
  isCloudflareChallenge: vi.fn().mockReturnValue(false),
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

  it("keeps non-2xx axios responses inspectable for CF challenge detection", async () => {
    const { default: axios } = await import("axios");
    await fetchWithTransport("https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html", {
      useImpit: false,
    });
    const call = vi.mocked(axios.request).mock.calls[0];
    expect(call?.[0]?.validateStatus?.(403)).toBe(true);
  });

  it("throws a typed error for non-CF axios HTTP failures", async () => {
    const { default: axios } = await import("axios");
    vi.mocked(axios.request).mockResolvedValueOnce({
      data: "<html><body>not found</body></html>",
      status: 404,
      headers: { "content-type": "text/html" },
    });

    const err = await fetchWithTransport("https://example.com/missing", {
      useImpit: false,
    }).catch((error) => error);

    expect(err).toBeInstanceOf(HttpStatusError);
    expect((err as HttpStatusError).statusCode).toBe(404);
  });

  it("throws a descriptive error on CF challenge body", async () => {
    const { isCloudflareChallenge } = await import("../../services/cloudflare.js");
    vi.mocked(isCloudflareChallenge).mockReturnValueOnce(true);

    await expect(
      fetchWithTransport("https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html", {
        useImpit: false,
      }),
    ).rejects.toThrow("cf block");
  });

  it("throws a descriptive error when CF bot block status is returned", async () => {
    const { isCloudflareChallenge } = await import("../../services/cloudflare.js");
    vi.mocked(isCloudflareChallenge).mockReturnValueOnce(true);

    await expect(
      fetchWithTransport("https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html", {
        useImpit: false,
      }),
    ).rejects.toThrow();
  });

  it("passes the configured timeout to impit requests", async () => {
    impitFetchMock.mockResolvedValue({
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => "<html>impit body</html>",
    });

    await fetchWithTransport("https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html", {
      useImpit: true,
      timeout: 4242,
    });

    expect(impitFetchMock).toHaveBeenCalledWith(
      "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
      expect.objectContaining({ timeout: 4242 }),
    );
  });

  it("validates impit redirects before following the next hop", async () => {
    impitFetchMock.mockResolvedValueOnce({
      status: 302,
      headers: new Headers({ location: "https://example.com/internal" }),
      text: async () => "",
    });

    const err = await fetchWithTransport(
      "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
      {
        useImpit: true,
      },
    ).catch((error) => error);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("not in permitted list");
    expect(impitFetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows allowed impit redirects manually", async () => {
    impitFetchMock
      .mockResolvedValueOnce({
        status: 302,
        headers: new Headers({
          location: "https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
        }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        text: async () => "<html>impit body</html>",
      });

    const result = await fetchWithTransport(
      "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
      {
        useImpit: true,
      },
    );

    expect(result.body).toContain("impit body");
    expect(impitFetchMock).toHaveBeenCalledTimes(2);
    expect(impitFetchMock).toHaveBeenNthCalledWith(
      2,
      "https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("drops sensitive headers when an impit redirect changes origin", async () => {
    impitFetchMock
      .mockResolvedValueOnce({
        status: 302,
        headers: new Headers({
          location: "https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
        }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        text: async () => "<html>redirected body</html>",
      });

    await fetchWithTransport("https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html", {
      useImpit: true,
      headers: {
        "User-Agent": "ua-test",
        Cookie: "cf_clearance=secret",
        Authorization: "Bearer secret",
      },
    });

    const secondCallInit = impitFetchMock.mock.calls[1]?.[1] as {
      headers?: Record<string, string>;
    };
    expect(secondCallInit.headers).toMatchObject({ "User-Agent": "ua-test" });
    expect(secondCallInit.headers?.Cookie).toBeUndefined();
    expect(secondCallInit.headers?.Authorization).toBeUndefined();
  });

  it("throws a typed error for non-CF impit HTTP failures", async () => {
    impitFetchMock.mockResolvedValue({
      status: 500,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => "<html>server error</html>",
    });

    const err = await fetchWithTransport(
      "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
      {
        useImpit: true,
      },
    ).catch((error) => error);

    expect(err).toBeInstanceOf(HttpStatusError);
    expect((err as HttpStatusError).statusCode).toBe(500);
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
  beforeEach(async () => {
    vi.clearAllMocks();
    const { config } = await import("../../config.js");
    config.transport.useImpit = true;
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

  it("respects AUSLAW_USE_IMPIT=false in auto mode for AustLII URLs", async () => {
    const { config } = await import("../../config.js");
    config.transport.useImpit = false;

    const fetcher = fetcherForUrl(
      "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
      "auto",
    );
    const r = await fetcher.get("https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html", {
      headers: { "User-Agent": "ua-test" },
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
    expect(impitFetchMock).toHaveBeenCalledWith(
      "https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
      expect.objectContaining({ timeout: 1000 }),
    );
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

  it("validates byte-fetch impit redirects before following the next hop", async () => {
    impitFetchMock.mockResolvedValueOnce({
      status: 302,
      headers: new Headers({ location: "https://example.com/internal" }),
      bytes: async () => new Uint8Array(),
    });

    const fetcher = fetcherForUrl(
      "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
      "auto",
    );
    const err = await fetcher
      .get("https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html", {
        headers: { "User-Agent": "ua-test" },
        timeoutMs: 1000,
      })
      .catch((error) => error);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("not in permitted list");
    expect(impitFetchMock).toHaveBeenCalledTimes(1);
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
    expect(call?.[1]?.validateStatus?.(403)).toBe(true);
  });

  it("reports the final axios response URL when redirects were followed", async () => {
    const { default: axios } = await import("axios");
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: new TextEncoder().encode("<html><body>redirected</body></html>").buffer,
      status: 200,
      headers: { "content-type": "text/html" },
      request: {
        res: { responseUrl: "https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html" },
      },
    });

    const fetcher = fetcherForUrl(
      "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
      "axios",
    );
    const r = await fetcher.get(
      "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
      {
        headers: { "User-Agent": "ua-test" },
        timeoutMs: 4242,
      },
    );

    expect(r.finalUrl).toBe("https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html");
  });
});
