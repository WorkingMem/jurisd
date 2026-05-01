import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFs = vi.hoisted(() => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("node:fs", () => ({
  promises: mockFs,
}));

vi.mock("axios");
vi.mock("../../services/fetcher.js");
vi.mock("../../utils/url-guard.js");

import axios from "axios";
import { fetchDocumentText } from "../../services/fetcher.js";
import { assertFetchableUrl } from "../../utils/url-guard.js";
import { checkSourceFreshness, storeSource } from "../../services/source-store.js";

const SOURCES_DIR = "/test/project/sources";
const TEST_URL = "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html";
const SAMPLE_TEXT = "The High Court held that native title exists.";

beforeEach(() => {
  vi.clearAllMocks();
  mockFs.mkdir.mockResolvedValue(undefined);
  mockFs.writeFile.mockResolvedValue(undefined);
  vi.mocked(assertFetchableUrl).mockReturnValue(undefined);
});

describe("checkSourceFreshness", () => {
  it("returns fresh:true when server responds 304", async () => {
    vi.mocked(axios.head).mockResolvedValueOnce({
      status: 304,
      headers: { etag: '"new-etag"', "last-modified": "Wed, 01 Jan 2026 00:00:00 GMT" },
    });

    const result = await checkSourceFreshness(
      TEST_URL,
      '"old-etag"',
      "Tue, 31 Dec 2025 00:00:00 GMT",
    );
    expect(result.fresh).toBe(true);
    expect(result.etag).toBe('"new-etag"');
  });

  it("returns fresh:false when server responds 200", async () => {
    vi.mocked(axios.head).mockResolvedValueOnce({
      status: 200,
      headers: { etag: '"new-etag"' },
    });

    const result = await checkSourceFreshness(TEST_URL, '"old-etag"');
    expect(result.fresh).toBe(false);
  });

  it("sends If-None-Match header when etag provided", async () => {
    vi.mocked(axios.head).mockResolvedValueOnce({ status: 304, headers: {} });

    await checkSourceFreshness(TEST_URL, '"test-etag"');
    const callArgs = vi.mocked(axios.head).mock.calls[0]!;
    expect(callArgs?.[1]?.headers?.["If-None-Match"]).toBe('"test-etag"');
  });

  it("sends If-Modified-Since header when lastModified provided", async () => {
    vi.mocked(axios.head).mockResolvedValueOnce({ status: 304, headers: {} });

    await checkSourceFreshness(TEST_URL, undefined, "Tue, 31 Dec 2025 00:00:00 GMT");
    const callArgs = vi.mocked(axios.head).mock.calls[0]!;
    expect(callArgs?.[1]?.headers?.["If-Modified-Since"]).toBe("Tue, 31 Dec 2025 00:00:00 GMT");
  });

  it("returns fresh:false on network error", async () => {
    vi.mocked(axios.head).mockRejectedValueOnce(new Error("Network error"));
    const result = await checkSourceFreshness(TEST_URL, '"etag"');
    expect(result.fresh).toBe(false);
  });

  it("returns fresh:false when no conditional headers provided", async () => {
    vi.mocked(axios.head).mockResolvedValueOnce({ status: 200, headers: {} });
    const result = await checkSourceFreshness(TEST_URL);
    expect(result.fresh).toBe(false);
  });
});

describe("storeSource", () => {
  beforeEach(() => {
    vi.mocked(fetchDocumentText).mockResolvedValue({
      text: SAMPLE_TEXT,
      contentType: "text/html",
      sourceUrl: TEST_URL,
      ocrUsed: false,
    });
    // HEAD for ETag capture after fetch
    vi.mocked(axios.head).mockResolvedValue({
      status: 200,
      headers: { etag: '"etag-1"', "last-modified": "Wed, 01 Jan 2026 00:00:00 GMT" },
    });
  });

  it("downloads and writes file when no cached entry", async () => {
    const result = await storeSource("mabo1992", TEST_URL, null, SOURCES_DIR);
    expect(result.changed).toBe(true);
    expect(mockFs.writeFile).toHaveBeenCalledOnce();
    const writtenContent = mockFs.writeFile.mock.calls[0]![1] as string;
    expect(writtenContent).toContain(`> Source: ${TEST_URL}`);
    expect(writtenContent).toContain(SAMPLE_TEXT);
  });

  it("returns correct contentHash", async () => {
    const result = await storeSource("mabo1992", TEST_URL, null, SOURCES_DIR);
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sets changed:false when content hash matches cached hash", async () => {
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(SAMPLE_TEXT, "utf-8").digest("hex");

    const result = await storeSource("mabo1992", TEST_URL, { contentHash: hash }, SOURCES_DIR);
    expect(result.changed).toBe(false);
    // File should not be written again when content is unchanged
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it("sets changed:true when content hash differs", async () => {
    const result = await storeSource("mabo1992", TEST_URL, { contentHash: "oldhash" }, SOURCES_DIR);
    expect(result.changed).toBe(true);
    expect(mockFs.writeFile).toHaveBeenCalledOnce();
  });

  it("skips download when 304 freshness check passes", async () => {
    // Reset HEAD mock so first call returns 304
    vi.mocked(axios.head).mockResolvedValueOnce({ status: 304, headers: { etag: '"etag-1"' } });

    const result = await storeSource(
      "mabo1992",
      TEST_URL,
      { contentHash: "knowngoodhash", sourceEtag: '"etag-1"' },
      SOURCES_DIR,
    );

    expect(result.changed).toBe(false);
    expect(result.contentHash).toBe("knowngoodhash");
    expect(fetchDocumentText).not.toHaveBeenCalled();
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it("re-downloads when 304 check fails (stale)", async () => {
    // HEAD returns 200 (stale)
    vi.mocked(axios.head)
      .mockResolvedValueOnce({ status: 200, headers: { etag: '"etag-new"' } })
      .mockResolvedValueOnce({ status: 200, headers: { etag: '"etag-new"' } });

    const result = await storeSource(
      "mabo1992",
      TEST_URL,
      { contentHash: "oldhash", sourceEtag: '"etag-old"' },
      SOURCES_DIR,
    );

    expect(fetchDocumentText).toHaveBeenCalledOnce();
    expect(result.changed).toBe(true);
  });

  it("returns path under sourcesDir", async () => {
    const result = await storeSource("mabo1992", TEST_URL, null, SOURCES_DIR);
    expect(result.path).toBe(`${SOURCES_DIR}/mabo1992.md`);
  });

  it("captures etag from HEAD response", async () => {
    const result = await storeSource("mabo1992", TEST_URL, null, SOURCES_DIR);
    expect(result.etag).toBe('"etag-1"');
  });
});
