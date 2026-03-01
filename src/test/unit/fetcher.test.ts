import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import axios from "axios";
import { fileTypeFromBuffer } from "file-type";

vi.mock("file-type");
vi.mock("axios");

const mockConfig = vi.hoisted(() => ({
  source: {
    userAgent: "test-agent",
    timeout: 5000,
    sessionCookie: undefined as string | undefined,
  },
  ocr: { language: "eng", oem: 1, psm: 3 },
  austlii: { searchBase: "", referer: "", userAgent: "", timeout: 5000 },
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

  it("injects Cookie header for removed.invalid when sessionCookie configured", async () => {
    mockConfig.source.sessionCookie = "SESSIONAUTH=abc123";

    vi.mocked(axios.get).mockResolvedValueOnce({
      data: Buffer.from("<html><body>" + "x".repeat(300) + "</body></html>"),
      headers: { "content-type": "text/html" },
      status: 200,
    });

    await fetchDocumentText("https://removed.invalid/article/68901");

    expect(axios.get).toHaveBeenCalledWith(
      "https://removed.invalid/article/68901",
      expect.objectContaining({
        headers: expect.objectContaining({ Cookie: "SESSIONAUTH=abc123" }),
      }),
    );
  });

  it("throws helpful error on removed.invalid 401 when no cookie set", async () => {
    const err = Object.assign(new Error("Request failed with status code 401"), {
      response: { status: 401 },
    });
    vi.mocked(axios.get).mockRejectedValueOnce(err);
    vi.mocked(axios.isAxiosError).mockReturnValue(true);

    await expect(fetchDocumentText("https://removed.invalid/article/12345")).rejects.toThrow(
      /SESSION_COOKIE/,
    );
  });

  it("extracts paragraph blocks from AustLII HTML with [N] markers", async () => {
    const html = `<html><body>
      <p>[1] First paragraph text here.</p>
      <p>[2] Second paragraph about duty of care.</p>
      <p>[3] Third paragraph concluding.</p>
    </body></html>`;

    vi.mocked(axios.get).mockResolvedValueOnce({
      data: Buffer.from(html),
      headers: { "content-type": "text/html" },
      status: 200,
    });

    const result = await fetchDocumentText("https://www.austlii.edu.au/case");
    expect(result.paragraphs).toBeDefined();
    const paras = result.paragraphs!;
    expect(paras.length).toBe(3);
    expect(paras[1]!.number).toBe(2);
    expect(paras[1]!.text).toContain("duty of care");
  });
});
