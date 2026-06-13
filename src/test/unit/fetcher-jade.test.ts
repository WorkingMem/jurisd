/**
 * Tests for fetchDocumentText jade.io GWT-RPC paths.
 * Covers: no-article-ID, AxiosError 401/403, non-AxiosError rethrow.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

// ── Hoisted mock references ────────────────────────────────────────────────

const mockIsJadeUrl = vi.hoisted(() => vi.fn().mockReturnValue(true));
const mockExtractArticleId = vi.hoisted(() => vi.fn<() => number | undefined>());
const mockFetchJadeArticleContent = vi.hoisted(() => vi.fn<() => Promise<string>>());

vi.mock("../../services/jade.js", () => ({
  isJadeUrl: mockIsJadeUrl,
  extractArticleId: mockExtractArticleId,
  fetchJadeArticleContent: mockFetchJadeArticleContent,
  extractTextFromHtml: vi.fn().mockReturnValue("extracted text"),
  extractParagraphBlocks: vi.fn().mockReturnValue([]),
  cleanHtmlForOutput: vi.fn().mockReturnValue("<article>text</article>"),
}));

vi.mock("../../config.js", () => ({
  config: {
    jade: {
      userAgent: "test-agent",
      timeout: 5000,
      sessionCookie: "IID=test; alcsessionid=abc",
      baseUrl: "https://jade.io",
    },
    austlii: { searchBase: "", referer: "", userAgent: "", timeout: 5000 },
    defaults: { searchLimit: 10, maxSearchLimit: 50, outputFormat: "json", sortBy: "auto" },
  },
}));

vi.mock("../../utils/rate-limiter.js", () => ({
  austliiRateLimiter: { throttle: vi.fn().mockResolvedValue(undefined) },
  jadeRateLimiter: { throttle: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("axios");

// Minimal mocks so fetcher.ts module-level imports don't crash
vi.mock("file-type", () => ({ fileTypeFromBuffer: vi.fn().mockResolvedValue(undefined) }));
vi.mock("pdf-parse", () => ({
  PDFParse: class {
    getText = vi.fn();
    destroy = vi.fn();
  },
}));
vi.mock("tmp", () => ({
  fileSync: vi.fn(() => ({ name: "/tmp/t.pdf", removeCallback: vi.fn() })),
}));
vi.mock("fs/promises", () => ({ writeFile: vi.fn().mockResolvedValue(undefined) }));
vi.mock("node:child_process", () => {
  const fn = vi.fn();
  Object.defineProperty(fn, Symbol.for("nodejs.util.promisify.custom"), {
    value: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
    writable: true,
    configurable: true,
  });
  return { execFile: fn };
});

import { fetchDocumentText } from "../../services/fetcher.js";

const JADE_ARTICLE_URL = "https://jade.io/article/67683";
const JADE_SEARCH_URL = "https://jade.io/search?q=mabo";

describe("fetchDocumentText — jade.io GWT-RPC paths", () => {
  beforeEach(() => {
    vi.mocked(axios.isAxiosError).mockReturnValue(false);
    mockExtractArticleId.mockReset();
    mockFetchJadeArticleContent.mockReset();
    mockIsJadeUrl.mockReturnValue(true);
  });

  it("throws when article ID cannot be extracted from jade.io URL (line 262)", async () => {
    mockExtractArticleId.mockReturnValue(undefined);

    await expect(fetchDocumentText(JADE_SEARCH_URL)).rejects.toThrow(
      "Could not extract article ID from jade.io URL",
    );
  });

  it("throws with expiry message when fetchJadeArticleContent returns 401 (line 275)", async () => {
    mockExtractArticleId.mockReturnValue(67683);
    const axiosErr = Object.assign(new Error("Unauthorized"), {
      isAxiosError: true,
      response: { status: 401 },
    });
    mockFetchJadeArticleContent.mockRejectedValue(axiosErr);
    vi.mocked(axios.isAxiosError).mockReturnValue(true);

    await expect(fetchDocumentText(JADE_ARTICLE_URL)).rejects.toThrow(
      /jade\.io returned 401.*JADE_SESSION_COOKIE.*expired/i,
    );
  });

  it("throws with expiry message when fetchJadeArticleContent returns 403 (line 275)", async () => {
    mockExtractArticleId.mockReturnValue(67683);
    const axiosErr = Object.assign(new Error("Forbidden"), {
      isAxiosError: true,
      response: { status: 403 },
    });
    mockFetchJadeArticleContent.mockRejectedValue(axiosErr);
    vi.mocked(axios.isAxiosError).mockReturnValue(true);

    await expect(fetchDocumentText(JADE_ARTICLE_URL)).rejects.toThrow(
      /jade\.io returned 403.*JADE_SESSION_COOKIE.*expired/i,
    );
  });

  it("throws generic AxiosError message for non-401/403 status (line 279)", async () => {
    mockExtractArticleId.mockReturnValue(67683);
    const axiosErr = Object.assign(new Error("Service Unavailable"), {
      isAxiosError: true,
      response: { status: 503 },
    });
    mockFetchJadeArticleContent.mockRejectedValue(axiosErr);
    vi.mocked(axios.isAxiosError).mockReturnValue(true);

    await expect(fetchDocumentText(JADE_ARTICLE_URL)).rejects.toThrow(
      /Failed to fetch jade\.io article/,
    );
  });

  it("rethrows non-AxiosError from fetchJadeArticleContent unchanged (line 281)", async () => {
    mockExtractArticleId.mockReturnValue(67683);
    const plainErr = new TypeError("Unexpected token");
    mockFetchJadeArticleContent.mockRejectedValue(plainErr);
    vi.mocked(axios.isAxiosError).mockReturnValue(false);

    await expect(fetchDocumentText(JADE_ARTICLE_URL)).rejects.toThrow("Unexpected token");
  });

  it("returns FetchResponse when fetchJadeArticleContent succeeds", async () => {
    mockExtractArticleId.mockReturnValue(67683);
    mockFetchJadeArticleContent.mockResolvedValue(
      "<html><body><p>[1] Mabo judgment text.</p></body></html>",
    );

    const result = await fetchDocumentText(JADE_ARTICLE_URL);
    expect(result.contentType).toBe("text/html");
    expect(result.sourceUrl).toBe(JADE_ARTICLE_URL);
    expect(result.metadata?.source).toBe("jade-gwt-rpc");
  });

  it("extracts text via jade-specific CSS selector when .judgment-text element is present (lines 122-124)", async () => {
    mockExtractArticleId.mockReturnValue(67683);
    // HTML with .judgment-text div containing >200 chars — covers extractTextFromJadeHtml lines 122-124
    const longText =
      "This judgment concerns native title rights. ".repeat(6) +
      "The High Court held unanimously that native title can exist.";
    mockFetchJadeArticleContent.mockResolvedValue(
      `<html><body><div class="judgment-text">${longText}</div></body></html>`,
    );

    const result = await fetchDocumentText(JADE_ARTICLE_URL);
    expect(result.text).toContain("native title");
    expect(result.contentType).toBe("text/html");
  });
});
