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
  jade: {
    userAgent: "test-agent",
    timeout: 5000,
    sessionCookie: undefined as string | undefined,
    baseUrl: "https://jade.io",
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
    mockConfig.jade.sessionCookie = undefined;
  });

  it("throws for jade.io URLs when no session cookie is configured", async () => {
    await expect(fetchDocumentText("https://jade.io/article/68901")).rejects.toThrow(
      /JADE_SESSION_COOKIE/i,
    );
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("calls jadeService.do via POST with avd2Request when session cookie is configured", async () => {
    mockConfig.jade.sessionCookie = "IID=abc; alcsessionid=xyz";

    const gwtHtml = "<DIV><P>[1] Judgment text here.</P></DIV>";
    // avd2Response format: [integers..., [string_table], 4, 7]
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: `//OK[0,-2,0,["Type/123","${gwtHtml}"],4,7]`,
      status: 200,
      headers: {},
    });

    const result = await fetchDocumentText("https://jade.io/article/67401");

    expect(axios.post).toHaveBeenCalledWith(
      "https://jade.io/jadeService.do",
      expect.stringContaining("avd2Request"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "text/x-gwt-rpc; charset=UTF-8",
          Cookie: "IID=abc; alcsessionid=xyz",
        }),
      }),
    );
    expect(result.text).toContain("Judgment text");
    expect(result.contentType).toBe("text/html");
    expect(result.sourceUrl).toBe("https://jade.io/article/67401");
  });

  it("sends GWT-encoded article ID in the avd2Request POST body", async () => {
    mockConfig.jade.sessionCookie = "alcsessionid=test";

    const gwtHtml = "<DIV>content</DIV>";
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: `//OK[0,-2,0,["Type/123","${gwtHtml}"],4,7]`,
      status: 200,
      headers: {},
    });

    await fetchDocumentText("https://jade.io/article/67401");

    const postBody = vi.mocked(axios.post).mock.calls[0]?.[1] as string;
    // Article 67401 encodes as "QdJ" in GWT integer encoding
    expect(postBody).toContain("QdJ");
    // Should NOT contain the raw integer
    expect(postBody).not.toMatch(/\|67401\|/);
  });

  it("does not expose JADE_SESSION_COOKIE in propagated error when jade.io GWT-RPC call fails", async () => {
    mockConfig.jade.sessionCookie = "IID=secret123; alcsessionid=abc456; cf_clearance=xxx";

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
      await fetchDocumentText("https://jade.io/article/67401");
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

  it("routes www.jade.io subdomain through jade GWT-RPC (hostname.endsWith check)", async () => {
    mockConfig.jade.sessionCookie = "IID=abc; alcsessionid=xyz";

    const jadeHtml = "<div class='judgment-text'><p>[1] Subdomain judgment text.</p></div>";
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: `//OK[0,-2,0,["Type/123","${jadeHtml}"],4,7]`,
      status: 200,
      headers: {},
    });

    const result = await fetchDocumentText("https://www.jade.io/article/67401");
    expect(result.text).toContain("Subdomain judgment text");
    expect(result.sourceUrl).toBe("https://www.jade.io/article/67401");
  });

  it("uses generic extraction for AustLII URL that contains 'jade.io' in query string", async () => {
    // Regression: old url.includes("jade.io") would misroute this to jade extraction.
    // assertFetchableUrl permits www.austlii.edu.au; hostname != jade.io so generic path is used.
    const html = "<html><body><p>AustLII generic content</p></body></html>";
    austliiGetMock.mockResolvedValueOnce({
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from(html),
      finalUrl: "https://www.austlii.edu.au/cgi-bin/viewdoc?ref=jade.io",
      via: "impit",
    });

    const result = await fetchDocumentText(
      "https://www.austlii.edu.au/cgi-bin/viewdoc?ref=jade.io",
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
