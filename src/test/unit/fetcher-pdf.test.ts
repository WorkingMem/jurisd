/**
 * Tests for fetchDocumentText PDF and OCR paths.
 * Requires mocking child_process (Tesseract), pdf-parse, tmp, and fs/promises.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fileTypeFromBuffer } from "file-type";

// AustLII PDFs route through the impit transport seam. Mock that seam (not
// axios) to return the PDF bytes so the shared PDF/OCR parse path runs offline.
const { getMock, fetcherForUrlMock } = vi.hoisted(() => {
  const getMock = vi.fn();
  const fetcherForUrlMock = vi.fn(() => ({ get: getMock }));
  return { getMock, fetcherForUrlMock };
});
vi.mock("../../services/transport.js", () => ({ fetcherForUrl: fetcherForUrlMock }));
vi.mock("../../services/cloudflare.js", () => ({
  isCloudflareChallenge: vi.fn().mockReturnValue(false),
}));

// ── Hoisted mock references ────────────────────────────────────────────────

// execFileAsync mock: add the Node.js custom promisify symbol so that
// promisify(execFile) in fetcher.ts wraps this function, preserving
// the { stdout, stderr } resolved-value shape.
const mockExecFileAsync = vi.hoisted(() => vi.fn().mockResolvedValue({ stdout: "", stderr: "" }));

vi.mock("node:child_process", () => {
  const fn = vi.fn(); // the raw execFile mock (used by promisify internally)
  Object.defineProperty(fn, Symbol.for("nodejs.util.promisify.custom"), {
    value: mockExecFileAsync,
    writable: true,
    configurable: true,
  });
  return { execFile: fn };
});

// tmp mock — fileSync returns a fake temp file handle
vi.mock("tmp", () => ({
  fileSync: vi.fn(() => ({ name: "/tmp/test-ocr.pdf", removeCallback: vi.fn() })),
}));

// fs/promises mock — only writeFile is called in the OCR path
vi.mock("fs/promises", () => ({ writeFile: vi.fn().mockResolvedValue(undefined) }));

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
    source: {
      userAgent: "test-agent",
      timeout: 5000,
      sessionCookie: undefined,
      baseUrl: "https://removed.invalid",
    },
    ocr: { language: "eng", oem: 1, psm: 3 },
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
  upstreamRateLimiter: { throttle: vi.fn().mockResolvedValue(undefined) },
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
    mockExecFileAsync.mockReset();
    mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
  });

  it("extracts text directly when PDF has substantial text (>100 chars)", async () => {
    const longText = "A".repeat(200);
    mockGetText.mockResolvedValue({ text: longText });
    mockPdfAxiosResponse();

    const result = await fetchDocumentText(PDF_URL);
    expect(result.ocrUsed).toBe(false);
    expect(result.text).toBe(longText);
    expect(result.contentType).toContain("application/pdf");
  });

  it("falls back to OCR when PDF text is too short (<=100 chars)", async () => {
    mockGetText.mockResolvedValue({ text: "short text" }); // <100 chars → triggers OCR
    mockExecFileAsync.mockResolvedValue({
      stdout: "OCR extracted text from scanned PDF",
      stderr: "",
    });
    mockPdfAxiosResponse();

    const result = await fetchDocumentText(PDF_URL);
    expect(result.ocrUsed).toBe(true);
    expect(result.text).toBe("OCR extracted text from scanned PDF");
  });

  it("falls back to OCR when pdf-parse throws", async () => {
    mockGetText.mockRejectedValue(new Error("Invalid PDF structure"));
    mockExecFileAsync.mockResolvedValue({ stdout: "OCR text from fallback", stderr: "" });
    mockPdfAxiosResponse();

    const result = await fetchDocumentText(PDF_URL);
    expect(result.ocrUsed).toBe(true);
    expect(result.text).toBe("OCR text from fallback");
  });

  it("throws with OCR-failed message when Tesseract exits with error", async () => {
    mockGetText.mockResolvedValue({ text: "tiny" }); // triggers OCR
    mockExecFileAsync.mockRejectedValue(new Error("tesseract: command not found"));
    mockPdfAxiosResponse();

    await expect(fetchDocumentText(PDF_URL)).rejects.toThrow("OCR failed");
  });

  it("cleans up temp file even when OCR fails", async () => {
    const { fileSync } = await import("tmp");
    const removeSpy = vi.fn();
    vi.mocked(fileSync).mockReturnValueOnce({
      name: "/tmp/cleanup-test.pdf",
      removeCallback: removeSpy,
    } as unknown as ReturnType<typeof fileSync>);

    mockGetText.mockResolvedValue({ text: "tiny" });
    mockExecFileAsync.mockRejectedValue(new Error("tesseract not found"));
    mockPdfAxiosResponse();

    await expect(fetchDocumentText(PDF_URL)).rejects.toThrow();
    expect(removeSpy).toHaveBeenCalled();
  });
});
