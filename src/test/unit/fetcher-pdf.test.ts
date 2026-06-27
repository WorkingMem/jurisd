/**
 * Tests for fetchDocumentText PDF handling (pdf-parse digital text extraction).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fileTypeFromBuffer } from "file-type";

// AustLII PDFs route through the impit transport seam. Mock that seam (not
// axios) to return the PDF bytes so the shared PDF parse path runs offline.
const { getMock, fetcherForUrlMock } = vi.hoisted(() => {
  const getMock = vi.fn();
  const fetcherForUrlMock = vi.fn(() => ({ get: getMock }));
  return { getMock, fetcherForUrlMock };
});
vi.mock("../../services/transport.js", () => ({ fetcherForUrl: fetcherForUrlMock }));
vi.mock("../../services/cloudflare.js", () => ({
  isCloudflareChallenge: vi.fn().mockReturnValue(false),
}));

// pdf-parse mock — use a class so `new PDFParse()` works correctly with clearMocks:true
const mockGetText = vi.hoisted(() => vi.fn());
const mockDestroy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("pdf-parse", () => ({
  PDFParse: class {
    getText = mockGetText;
    destroy = mockDestroy;
  },
}));

vi.mock("file-type");
vi.mock("../../config.js", () => ({
  config: {
    austlii: {
      searchBase: "",
      referer: "",
      userAgent: "test-austlii-ua",
      timeout: 5000,
      transport: "auto",
      classicRewrite: true,
      cfClearance: undefined,
      accept: "text/html",
      acceptLanguage: "en-AU,en;q=0.9",
    },
    oalc: { enabled: true, source: "/tmp/fixture.jsonl" },
    transport: { useImpit: false, imitBrowser: "chrome" },
    defaults: { searchLimit: 10, maxSearchLimit: 50, outputFormat: "json", sortBy: "auto" },
  },
}));
vi.mock("../../utils/rate-limiter.js", () => ({
  austliiRateLimiter: { throttle: vi.fn().mockResolvedValue(undefined) },
}));

import { fetchDocumentText } from "../../services/fetcher.js";

const PDF_URL = "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.pdf";

function mockPdfAxiosResponse() {
  getMock.mockResolvedValueOnce({
    status: 200,
    headers: { "content-type": "application/pdf" },
    body: Buffer.from("fake pdf binary"),
    finalUrl: PDF_URL,
    via: "impit" as const,
  });
  vi.mocked(fileTypeFromBuffer).mockResolvedValue(undefined);
}

describe("fetchDocumentText — PDF content type", () => {
  beforeEach(() => {
    mockGetText.mockReset();
    mockDestroy.mockReset();
    mockDestroy.mockResolvedValue(undefined);
  });

  it("extracts the embedded text layer of a digital PDF", async () => {
    const longText = "A".repeat(200);
    mockGetText.mockResolvedValue({ text: longText });
    mockPdfAxiosResponse();

    const result = await fetchDocumentText(PDF_URL);
    expect(result.text).toBe(longText);
    expect(result.contentType).toContain("application/pdf");
  });

  it("returns the extracted text as-is when it is short", async () => {
    mockGetText.mockResolvedValue({ text: "short text" });
    mockPdfAxiosResponse();

    const result = await fetchDocumentText(PDF_URL);
    expect(result.text).toBe("short text");
  });

  it("returns empty text when pdf-parse fails", async () => {
    mockGetText.mockRejectedValue(new Error("Invalid PDF structure"));
    mockPdfAxiosResponse();

    const result = await fetchDocumentText(PDF_URL);
    expect(result.text).toBe("");
  });
});
