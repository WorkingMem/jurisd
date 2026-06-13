import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import axios from "axios";
import { fileTypeFromBuffer } from "file-type";

vi.mock("file-type");
vi.mock("axios");

// AustLII routes through the impit transport seam; mock it so these tests stay
// offline and don't touch the impit native binary.
const { austliiGetMock } = vi.hoisted(() => ({ austliiGetMock: vi.fn() }));
vi.mock("../../services/transport.js", () => ({
  fetcherForUrl: vi.fn(() => ({ get: austliiGetMock })),
}));
vi.mock("../../services/cloudflare.js", () => ({
  isCloudflareChallenge: vi.fn().mockReturnValue(false),
}));

const mockConfig = vi.hoisted(() => ({
  source: {
    userAgent: "test-agent",
    timeout: 5000,
    sessionCookie: undefined as string | undefined,
    baseUrl: "https://removed.invalid",
  },
  austlii: {
    searchBase: "",
    referer: "",
    userAgent: "test-austlii-ua",
    timeout: 5000,
    transport: "auto" as const,
    classicRewrite: true,
    cfClearance: undefined as string | undefined,
    accept: "text/html",
    acceptLanguage: "en-AU,en;q=0.9",
  },
  oalc: { enabled: true, source: "/tmp/fixture.jsonl" },
  transport: { useImpit: false, imitBrowser: "chrome" },
  defaults: {
    searchLimit: 10,
    maxSearchLimit: 50,
    outputFormat: "json",
    sortBy: "auto",
  },
}));

vi.mock("../../config.js", () => ({ config: mockConfig }));

import { fetchDocumentText } from "../../services/fetcher.js";

describe("fetchDocumentText", () => {
  beforeEach(() => {
    vi.mocked(fileTypeFromBuffer).mockResolvedValue(undefined);
    vi.mocked(axios.isAxiosError).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockConfig.source.sessionCookie = undefined;
  });

  it("throws for removed.invalid URLs when no session cookie is configured", async () => {
    await expect(fetchDocumentText("https://removed.invalid/article/68901")).rejects.toThrow(
      /SESSION_COOKIE/i,
    );
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("calls sourceService.do via POST with fetchRequest when session cookie is configured", async () => {
    mockConfig.source.sessionCookie = "IID=abc; alcsessionid=xyz";

    const rpcHtml = "<DIV><P>[1] Judgment text here.</P></DIV>";
    // fetchResponse format: [integers..., [string_table], 4, 7]
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: `//OK[0,-2,0,["Type/123","${rpcHtml}"],4,7]`,
      status: 200,
      headers: {},
    });

    const result = await fetchDocumentText("https://removed.invalid/article/67401");

    expect(axios.post).toHaveBeenCalledWith(
      "https://removed.invalid/sourceService.do",
      expect.stringContaining("fetchRequest"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "text/x-rpc-rpc; charset=UTF-8",
          Cookie: "IID=abc; alcsessionid=xyz",
        }),
      }),
    );
    expect(result.text).toContain("Judgment text");
    expect(result.contentType).toBe("text/html");
    expect(result.sourceUrl).toBe("https://removed.invalid/article/67401");
  });

  it("sends RPC-encoded article ID in the fetchRequest POST body", async () => {
    mockConfig.source.sessionCookie = "alcsessionid=test";

    const rpcHtml = "<DIV>content</DIV>";
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: `//OK[0,-2,0,["Type/123","${rpcHtml}"],4,7]`,
      status: 200,
      headers: {},
    });

    await fetchDocumentText("https://removed.invalid/article/67401");

    const postBody = vi.mocked(axios.post).mock.calls[0]?.[1] as string;
    // Article 67401 encodes as "QdJ" in RPC integer encoding
    expect(postBody).toContain("QdJ");
    // Should NOT contain the raw integer
    expect(postBody).not.toMatch(/\|67401\|/);
  });

  it("does not expose SESSION_COOKIE in propagated error when removed.invalid RPC call fails", async () => {
    mockConfig.source.sessionCookie = "IID=secret123; alcsessionid=abc456; cf_clearance=xxx";

    // Simulate an AxiosError carrying the Cookie header in config (as axios does on failure)
    const axiosError = Object.assign(new Error("Network Error"), {
      isAxiosError: true,
      config: {
        headers: { Cookie: "IID=secret123; alcsessionid=abc456; cf_clearance=xxx" },
      },
      response: undefined,
    });
    vi.mocked(axios.post).mockRejectedValueOnce(axiosError);
    vi.mocked(axios.isAxiosError).mockReturnValue(true);

    let caughtError: unknown;
    try {
      await fetchDocumentText("https://removed.invalid/article/67401");
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeDefined();
    // The error message must not contain the raw session cookie value
    const errorMessage = caughtError instanceof Error ? caughtError.message : String(caughtError);
    expect(errorMessage).not.toContain("secret123");
    expect(errorMessage).not.toContain("alcsessionid=abc456");
    // The propagated error must not carry config.headers with the Cookie
    if (caughtError && typeof caughtError === "object" && "config" in caughtError) {
      const errConfig = (caughtError as { config?: { headers?: { Cookie?: string } } }).config;
      expect(errConfig?.headers?.Cookie).not.toContain("secret123");
    }
  });

  it("routes www.removed.invalid subdomain through source RPC (hostname.endsWith check)", async () => {
    mockConfig.source.sessionCookie = "IID=abc; alcsessionid=xyz";

    const sourceHtml = "<div class='judgment-text'><p>[1] Subdomain judgment text.</p></div>";
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: `//OK[0,-2,0,["Type/123","${sourceHtml}"],4,7]`,
      status: 200,
      headers: {},
    });

    const result = await fetchDocumentText("https://www.removed.invalid/article/67401");
    expect(result.text).toContain("Subdomain judgment text");
    expect(result.sourceUrl).toBe("https://www.removed.invalid/article/67401");
  });

  it("uses generic extraction for AustLII URL that contains 'removed.invalid' in query string", async () => {
    // Regression: old url.includes("removed.invalid") would misroute this to source extraction.
    // assertFetchableUrl permits www.austlii.edu.au; hostname != removed.invalid so generic path is used.
    const html = "<html><body><p>AustLII generic content</p></body></html>";
    austliiGetMock.mockResolvedValueOnce({
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from(html),
      finalUrl: "https://www.austlii.edu.au/cgi-bin/viewdoc?ref=removed.invalid",
      via: "impit",
    });

    const result = await fetchDocumentText(
      "https://www.austlii.edu.au/cgi-bin/viewdoc?ref=removed.invalid",
    );
    expect(result.text).toContain("AustLII generic content");
  });

  it("extracts paragraph blocks from AustLII HTML with [N] markers", async () => {
    const html = `<html><body>
      <p>[1] First paragraph text here.</p>
      <p>[2] Second paragraph about duty of care.</p>
      <p>[3] Third paragraph concluding.</p>
    </body></html>`;

    austliiGetMock.mockResolvedValueOnce({
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from(html),
      finalUrl: "https://www.austlii.edu.au/case",
      via: "impit",
    });

    const result = await fetchDocumentText("https://www.austlii.edu.au/case");
    expect(result.paragraphs).toBeDefined();
    const paras = result.paragraphs!;
    expect(paras.length).toBe(3);
    expect(paras[1]!.number).toBe(2);
    expect(paras[1]!.text).toContain("duty of care");
  });
});
