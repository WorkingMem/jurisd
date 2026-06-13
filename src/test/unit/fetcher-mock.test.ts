import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchDocumentText } from "../../services/fetcher.js";
import { AUSTLII_CLASSIC_JUDGMENT_HTML } from "../fixtures/index.js";
import { CloudflareBlockedError } from "../../errors.js";

// Mock the TRANSPORT SEAM (not axios) for AustLII paths, plus the OALC fallback
// and the CF detector, so the routing branches are deterministic and offline.
const { getMock, fetcherForUrlMock, lookupByCitationMock, isCloudflareChallengeMock } = vi.hoisted(
  () => {
    const getMock = vi.fn();
    const fetcherForUrlMock = vi.fn(() => ({ get: getMock }));
    const lookupByCitationMock = vi.fn();
    const isCloudflareChallengeMock = vi.fn().mockReturnValue(false);
    return { getMock, fetcherForUrlMock, lookupByCitationMock, isCloudflareChallengeMock };
  },
);

vi.mock("../../services/transport.js", () => ({
  fetcherForUrl: fetcherForUrlMock,
}));

vi.mock("../../services/oalc.js", () => ({
  lookupByCitation: lookupByCitationMock,
}));

vi.mock("../../services/cloudflare.js", () => ({
  isCloudflareChallenge: isCloudflareChallengeMock,
}));

vi.mock("file-type", () => ({
  fileTypeFromBuffer: vi.fn().mockResolvedValue(undefined),
}));

// Stub config explicitly. The ambient JADE_SESSION_COOKIE (and any AUSTLII_*
// env) on this machine would otherwise be captured by the config singleton.
const mockConfig = vi.hoisted(() => ({
  austlii: {
    userAgent: "test-austlii-ua/1.0",
    referer: "https://www.austlii.edu.au/forms/search1.html",
    timeout: 5000,
    transport: "auto" as const,
    classicRewrite: true,
    cfClearance: undefined as string | undefined,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    acceptLanguage: "en-AU,en;q=0.9",
  },
  jade: {
    userAgent: "jurisd-test",
    timeout: 5000,
    sessionCookie: undefined as string | undefined,
    baseUrl: "https://jade.io",
  },
  oalc: { enabled: true, source: "/tmp/fixture.jsonl" },
}));

vi.mock("../../config.js", () => ({ config: mockConfig }));

function htmlResponse(html: string) {
  return {
    status: 200,
    headers: { "content-type": "text/html" },
    body: Buffer.from(html, "utf-8"),
    finalUrl: "https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
    via: "impit" as const,
  };
}

const MABO_URL = "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html";

describe("fetchDocumentText AustLII routing (transport seam)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isCloudflareChallengeMock.mockReturnValue(false);
    mockConfig.austlii.transport = "auto";
    mockConfig.austlii.classicRewrite = true;
    mockConfig.austlii.cfClearance = undefined;
    mockConfig.oalc.enabled = true;
  });

  it("throws a descriptive error for jade.io URLs with no session cookie", async () => {
    mockConfig.jade.sessionCookie = undefined;
    await expect(fetchDocumentText("https://jade.io/article/67401")).rejects.toThrow(
      /fetch_document_text.*jade\.io/i,
    );
  });

  it("applies the classic-doc rewrite before fetching", async () => {
    getMock.mockResolvedValue(htmlResponse(AUSTLII_CLASSIC_JUDGMENT_HTML));
    await fetchDocumentText(MABO_URL);
    expect(getMock).toHaveBeenCalledTimes(1);
    const target = String(getMock.mock.calls[0]?.[0] ?? "");
    expect(target).toBe("https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html");
  });

  it("sends the User-Agent from config.austlii (fixes the v1 UA bug)", async () => {
    getMock.mockResolvedValue(htmlResponse(AUSTLII_CLASSIC_JUDGMENT_HTML));
    await fetchDocumentText(MABO_URL);
    const opts = getMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(opts.headers["User-Agent"]).toBe("test-austlii-ua/1.0");
    // Must NOT be the jade UA (the precise v1 defect).
    expect(opts.headers["User-Agent"]).not.toBe("jurisd-test");
    expect(opts.headers["Accept-Language"]).toBe("en-AU,en;q=0.9");
  });

  it("attaches the cf_clearance cookie only when configured", async () => {
    getMock.mockResolvedValue(htmlResponse(AUSTLII_CLASSIC_JUDGMENT_HTML));
    mockConfig.austlii.cfClearance = "SECRET_CLEARANCE_TOKEN";
    await fetchDocumentText(MABO_URL);
    const opts = getMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(opts.headers["Cookie"]).toBe("cf_clearance=SECRET_CLEARANCE_TOKEN");
  });

  it("parses a clean AustLII response exactly as today", async () => {
    getMock.mockResolvedValue(htmlResponse(AUSTLII_CLASSIC_JUDGMENT_HTML));
    const result = await fetchDocumentText(MABO_URL);
    expect(result.text).toContain("Mabo");
    expect(result.contentType).toBe("text/html");
    expect(result.sourceUrl).toBe(MABO_URL);
    expect(result.metadata!.source).toBeUndefined();
  });

  it("on CF challenge: consults OALC and returns oalc-fallback on a hit", async () => {
    getMock.mockResolvedValue({
      status: 403,
      headers: { "content-type": "text/html" },
      body: Buffer.from("Just a moment...", "utf-8"),
      finalUrl: MABO_URL,
      via: "impit" as const,
    });
    isCloudflareChallengeMock.mockReturnValue(true);
    lookupByCitationMock.mockResolvedValue({
      version_id: "x",
      type: "decision",
      jurisdiction: "commonwealth",
      source: "high_court_of_australia",
      mime: "text/html",
      date: "1992-06-03",
      citation: "Mabo v Queensland (No 2) [1992] HCA 23",
      url: "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
      when_scraped: "2024-09-01",
      text: "Mabo v Queensland (No 2) [1992] HCA 23 — native title recognised.",
    });

    const result = await fetchDocumentText(MABO_URL);
    expect(lookupByCitationMock).toHaveBeenCalledWith("[1992] HCA 23", false);
    expect(result.metadata!.source).toBe("oalc-fallback");
    expect(result.sourceUrl).toBe(MABO_URL);
    expect(result.text).toContain("native title");
  });

  it("on CF challenge with OALC miss: throws CloudflareBlockedError(fallbackTried=true)", async () => {
    getMock.mockResolvedValue({
      status: 403,
      headers: { "content-type": "text/html" },
      body: Buffer.from("Just a moment...", "utf-8"),
      finalUrl: MABO_URL,
      via: "impit" as const,
    });
    isCloudflareChallengeMock.mockReturnValue(true);
    lookupByCitationMock.mockResolvedValue(null);

    const err = await fetchDocumentText(MABO_URL).catch((e) => e);
    expect(err).toBeInstanceOf(CloudflareBlockedError);
    expect((err as CloudflareBlockedError).fallbackTried).toBe(true);
    expect((err as CloudflareBlockedError).resourceUrl).toBe(MABO_URL);
  });

  it("on CF challenge with OALC disabled: throws CloudflareBlockedError(fallbackTried=false)", async () => {
    getMock.mockResolvedValue({
      status: 403,
      headers: { "content-type": "text/html" },
      body: Buffer.from("Just a moment...", "utf-8"),
      finalUrl: MABO_URL,
      via: "impit" as const,
    });
    isCloudflareChallengeMock.mockReturnValue(true);
    mockConfig.oalc.enabled = false;

    const err = await fetchDocumentText(MABO_URL).catch((e) => e);
    expect(err).toBeInstanceOf(CloudflareBlockedError);
    expect((err as CloudflareBlockedError).fallbackTried).toBe(false);
    expect(lookupByCitationMock).not.toHaveBeenCalled();
  });

  it("never leaks the cf_clearance cookie in a CloudflareBlockedError", async () => {
    getMock.mockResolvedValue({
      status: 403,
      headers: { "content-type": "text/html" },
      body: Buffer.from("Just a moment...", "utf-8"),
      finalUrl: MABO_URL,
      via: "impit" as const,
    });
    isCloudflareChallengeMock.mockReturnValue(true);
    mockConfig.austlii.cfClearance = "SECRET_CLEARANCE_TOKEN";
    mockConfig.oalc.enabled = false;

    const err = await fetchDocumentText(MABO_URL).catch((e) => e);
    expect((err as Error).message).not.toContain("SECRET_CLEARANCE_TOKEN");
    expect((err as Error).message).not.toMatch(/cf_clearance=/);
  });

  it("CF challenge on a non-case (legislation) URL throws fallbackTried=true when no citation", async () => {
    const legisUrl = "https://www.austlii.edu.au/au/legis/cth/consol_act/paa1988125.html";
    getMock.mockResolvedValue({
      status: 403,
      headers: { "content-type": "text/html" },
      body: Buffer.from("Just a moment...", "utf-8"),
      finalUrl: legisUrl,
      via: "impit" as const,
    });
    isCloudflareChallengeMock.mockReturnValue(true);

    const err = await fetchDocumentText(legisUrl).catch((e) => e);
    // No neutral citation derivable from a /legis/ URL -> no OALC lookup, but
    // OALC is enabled so fallbackTried is true.
    expect(err).toBeInstanceOf(CloudflareBlockedError);
    expect((err as CloudflareBlockedError).fallbackTried).toBe(true);
    expect(lookupByCitationMock).not.toHaveBeenCalled();
  });
});
