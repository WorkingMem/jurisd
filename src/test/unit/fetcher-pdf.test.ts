/**
 * Tests for fetchDocumentText PDF and OCR paths.
 * Requires mocking child_process (Tesseract), pdf-parse, tmp, and fs/promises.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { fileTypeFromBuffer } from "file-type";

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
vi.mock("axios");
vi.mock("../../config.js", () => ({
  config: {
    source: {
      userAgent: "test-agent",
      timeout: 5000,
      sessionCookie: undefined,
      baseUrl: "https://removed.invalid",
    },
    ocr: { language: "eng", oem: 1, psm: 3 },
    austlii: { searchBase: "", referer: "", userAgent: "", timeout: 5000 },
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
  vi.mocked(axios.get).mockResolvedValueOnce({
    data: Buffer.from("fake pdf binary"),
    headers: { "content-type": "application/pdf" },
    status: 200,
  });
  vi.mocked(fileTypeFromBuffer).mockResolvedValue(undefined);
  vi.mocked(axios.isAxiosError).mockReturnValue(false);
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
