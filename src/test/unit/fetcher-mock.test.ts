import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { fetchDocumentText } from "../../services/fetcher.js";
import { AUSTLII_JUDGMENT_HTML } from "../fixtures/index.js";
import { NetworkError, ParseError } from "../../errors.js";

vi.mock("axios");
vi.mock("file-type", () => ({
  fileTypeFromBuffer: vi.fn().mockResolvedValue(undefined),
}));

const mockedAxios = vi.mocked(axios, true);

describe("fetchDocumentText (mocked)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAxios.isAxiosError.mockReturnValue(false);
  });

  it("should extract text from HTML content", async () => {
    mockedAxios.get.mockResolvedValue({
      data: Buffer.from(AUSTLII_JUDGMENT_HTML),
      status: 200,
      headers: { "content-type": "text/html" },
    });

    const result = await fetchDocumentText("https://www.austlii.edu.au/au/cases/cth/HCA/2024/1.html");
    expect(result.text).toBeTruthy();
    expect(result.text).toContain("Smith v Jones");
  });

  it("should preserve paragraph numbers [N] in extracted text", async () => {
    mockedAxios.get.mockResolvedValue({
      data: Buffer.from(AUSTLII_JUDGMENT_HTML),
      status: 200,
      headers: { "content-type": "text/html" },
    });

    const result = await fetchDocumentText("https://www.austlii.edu.au/au/cases/cth/HCA/2024/1.html");
    expect(result.text).toMatch(/\[1\]/);
    expect(result.text).toMatch(/\[4\]/);
  });

  it("should set correct metadata fields", async () => {
    mockedAxios.get.mockResolvedValue({
      data: Buffer.from(AUSTLII_JUDGMENT_HTML),
      status: 200,
      headers: { "content-type": "text/html" },
    });

    const result = await fetchDocumentText("https://www.austlii.edu.au/au/cases/cth/HCA/2024/1.html");
    expect(result.contentType).toBe("text/html");
    expect(result.sourceUrl).toBe("https://www.austlii.edu.au/au/cases/cth/HCA/2024/1.html");
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.contentLength).toBeDefined();
    expect(result.metadata!.contentType).toBe("text/html");
  });

  it("should set ocrUsed to false for HTML content", async () => {
    mockedAxios.get.mockResolvedValue({
      data: Buffer.from(AUSTLII_JUDGMENT_HTML),
      status: 200,
      headers: { "content-type": "text/html" },
    });

    const result = await fetchDocumentText("https://www.austlii.edu.au/au/cases/cth/HCA/2024/1.html");
    expect(result.ocrUsed).toBe(false);
  });

  it("should handle plain text content type", async () => {
    const plainText = "This is a plain text legal document.";
    mockedAxios.get.mockResolvedValue({
      data: Buffer.from(plainText),
      status: 200,
      headers: { "content-type": "text/plain" },
    });

    const result = await fetchDocumentText("https://example.com/doc.txt");
    expect(result.text).toBe(plainText);
    expect(result.contentType).toBe("text/plain");
    expect(result.ocrUsed).toBe(false);
  });

  it("should throw NetworkError on axios failure", async () => {
    const axiosError = new Error("Connection refused");
    mockedAxios.get.mockRejectedValue(axiosError);
    mockedAxios.isAxiosError.mockReturnValue(true);

    await expect(
      fetchDocumentText("https://www.austlii.edu.au/au/cases/cth/HCA/2024/1.html"),
    ).rejects.toThrow(NetworkError);
  });

  it("should throw ParseError for unsupported content type", async () => {
    mockedAxios.get.mockResolvedValue({
      data: Buffer.from("binary data"),
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    });

    await expect(
      fetchDocumentText("https://example.com/file.bin"),
    ).rejects.toThrow(ParseError);
  });
});
