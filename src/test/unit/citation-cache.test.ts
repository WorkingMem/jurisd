import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoist mock so vi.mock factory can reference it
const mockFs = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock("node:fs", () => ({
  promises: mockFs,
}));

import {
  generateCiteKey,
  loadCache,
  upsertCitation,
  getCitation,
  listCitations,
  exportBib,
  updateSourceFields,
} from "../../services/citation-cache.js";

const CACHE_DIR = "/test/project";

function makeEntry(overrides = {}) {
  return {
    citeKey: "mabo1992",
    id: "test-uuid",
    title: "Mabo v Queensland (No 2)",
    neutralCitation: "[1992] HCA 23",
    reportedCitation: "(1992) 175 CLR 1",
    aglc4Full: "Mabo v Queensland (No 2) [1992] HCA 23, (1992) 175 CLR 1",
    url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
    type: "case",
    jurisdiction: "cth",
    year: 1992,
    court: "HCA",
    keywords: [],
    documents: [],
    footnoteNumbers: {},
    addedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    bibType: "jurisdiction",
    bibFields: {
      title: "Mabo v Queensland (No 2)",
      year: "1992",
      citation: "[1992] HCA 23",
      reporter: "(1992) 175 CLR 1",
      url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
      note: "Mabo v Queensland (No 2) [1992] HCA 23, (1992) 175 CLR 1",
      court: "HCA",
      jurisdiction: "cth",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFs.mkdir.mockResolvedValue(undefined);
  mockFs.writeFile.mockResolvedValue(undefined);
});

describe("generateCiteKey", () => {
  it("extracts first word and appends year", () => {
    expect(generateCiteKey("Mabo v Queensland (No 2)", 1992)).toBe("mabo1992");
  });

  it("strips (No N) suffix", () => {
    expect(generateCiteKey("Mabo v Queensland (No 2)", 1992, [])).toBe("mabo1992");
  });

  it("handles 'Re' prefix", () => {
    expect(generateCiteKey("Re Smith", 2020)).toBe("smith2020");
  });

  it("handles 'Ex parte' prefix", () => {
    expect(generateCiteKey("Ex parte Jones", 2010)).toBe("jones2010");
  });

  it("appends suffix letter on collision", () => {
    const key = generateCiteKey("Mabo v Queensland (No 2)", 1992, ["mabo1992"]);
    expect(key).toBe("mabo1992a");
  });

  it("cycles through suffix letters for multiple collisions", () => {
    const key = generateCiteKey("Mabo v Queensland (No 2)", 1992, ["mabo1992", "mabo1992a"]);
    expect(key).toBe("mabo1992b");
  });

  it("works without a year", () => {
    expect(generateCiteKey("Smith v Jones")).toBe("smith");
  });
});

describe("loadCache", () => {
  it("returns empty cache when file does not exist", async () => {
    const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    mockFs.readFile.mockRejectedValueOnce(err);
    const cache = await loadCache(CACHE_DIR);
    expect(cache.entries).toHaveLength(0);
    expect(cache.version).toBe(1);
  });

  it("returns parsed cache when file exists", async () => {
    const data = JSON.stringify({
      version: 1,
      projectName: "project",
      entries: [makeEntry()],
    });
    mockFs.readFile.mockResolvedValueOnce(data);
    const cache = await loadCache(CACHE_DIR);
    expect(cache.entries).toHaveLength(1);
    expect(cache.entries[0]?.citeKey).toBe("mabo1992");
  });

  it("re-throws non-ENOENT errors", async () => {
    mockFs.readFile.mockRejectedValueOnce(new Error("EACCES"));
    await expect(loadCache(CACHE_DIR)).rejects.toThrow("EACCES");
  });
});

describe("upsertCitation", () => {
  it("creates new entry on empty cache", async () => {
    mockFs.readFile.mockRejectedValueOnce(Object.assign(new Error(), { code: "ENOENT" }));

    const citeKey = await upsertCitation(CACHE_DIR, {
      title: "Mabo v Queensland (No 2)",
      neutralCitation: "[1992] HCA 23",
      reportedCitation: "(1992) 175 CLR 1",
      aglc4Full: "Mabo v Queensland (No 2) [1992] HCA 23, (1992) 175 CLR 1",
      url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
      year: 1992,
    });

    expect(citeKey).toBe("mabo1992");
    expect(mockFs.writeFile).toHaveBeenCalledOnce();
    const written = JSON.parse(mockFs.writeFile.mock.calls[0]![1] as string);
    expect(written.entries).toHaveLength(1);
    expect(written.entries[0].citeKey).toBe("mabo1992");
  });

  it("updates existing entry without creating duplicate", async () => {
    const existing = JSON.stringify({
      version: 1,
      projectName: "project",
      entries: [makeEntry()],
    });
    mockFs.readFile.mockResolvedValueOnce(existing);

    const citeKey = await upsertCitation(CACHE_DIR, {
      title: "Mabo v Queensland (No 2)",
      neutralCitation: "[1992] HCA 23",
      aglc4Full: "Mabo v Queensland (No 2) [1992] HCA 23 at [20]",
      url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
    });

    expect(citeKey).toBe("mabo1992");
    const written = JSON.parse(mockFs.writeFile.mock.calls[0]![1] as string);
    expect(written.entries).toHaveLength(1);
    expect(written.entries[0].aglc4Full).toBe("Mabo v Queensland (No 2) [1992] HCA 23 at [20]");
  });

  it("adds document to documents array on first association", async () => {
    mockFs.readFile.mockRejectedValueOnce(Object.assign(new Error(), { code: "ENOENT" }));

    await upsertCitation(CACHE_DIR, {
      title: "Mabo v Queensland (No 2)",
      neutralCitation: "[1992] HCA 23",
      aglc4Full: "Mabo v Queensland (No 2) [1992] HCA 23",
      url: "https://example.com",
      document: "chapter-3",
      footnoteNumber: 5,
    });

    const written = JSON.parse(mockFs.writeFile.mock.calls[0]![1] as string);
    expect(written.entries[0].documents).toContain("chapter-3");
    expect(written.entries[0].footnoteNumbers["chapter-3"]).toBe(5);
  });

  it("does not duplicate documents array entry", async () => {
    const existing = JSON.stringify({
      version: 1,
      projectName: "project",
      entries: [makeEntry({ documents: ["chapter-3"] })],
    });
    mockFs.readFile.mockResolvedValueOnce(existing);

    await upsertCitation(CACHE_DIR, {
      title: "Mabo v Queensland (No 2)",
      neutralCitation: "[1992] HCA 23",
      aglc4Full: "Mabo v Queensland (No 2) [1992] HCA 23",
      url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
      document: "chapter-3",
    });

    const written = JSON.parse(mockFs.writeFile.mock.calls[0]![1] as string);
    expect(written.entries[0].documents.filter((d: string) => d === "chapter-3")).toHaveLength(1);
  });
});

describe("getCitation", () => {
  it("finds entry by citeKey", async () => {
    mockFs.readFile.mockResolvedValueOnce(
      JSON.stringify({ version: 1, projectName: "p", entries: [makeEntry()] }),
    );
    const result = await getCitation(CACHE_DIR, "mabo1992");
    expect(result?.citeKey).toBe("mabo1992");
  });

  it("finds entry by neutralCitation", async () => {
    mockFs.readFile.mockResolvedValueOnce(
      JSON.stringify({ version: 1, projectName: "p", entries: [makeEntry()] }),
    );
    const result = await getCitation(CACHE_DIR, "[1992] HCA 23");
    expect(result?.citeKey).toBe("mabo1992");
  });

  it("finds entry by aglc4Full string", async () => {
    mockFs.readFile.mockResolvedValueOnce(
      JSON.stringify({ version: 1, projectName: "p", entries: [makeEntry()] }),
    );
    const result = await getCitation(
      CACHE_DIR,
      "Mabo v Queensland (No 2) [1992] HCA 23, (1992) 175 CLR 1",
    );
    expect(result?.citeKey).toBe("mabo1992");
  });

  it("returns null when not found", async () => {
    mockFs.readFile.mockResolvedValueOnce(
      JSON.stringify({ version: 1, projectName: "p", entries: [] }),
    );
    const result = await getCitation(CACHE_DIR, "unknown");
    expect(result).toBeNull();
  });
});

describe("listCitations", () => {
  it("returns all entries when no document filter", async () => {
    mockFs.readFile.mockResolvedValueOnce(
      JSON.stringify({
        version: 1,
        projectName: "p",
        entries: [
          makeEntry({ documents: ["doc-a"] }),
          makeEntry({ citeKey: "telstra2010", title: "Telstra", documents: ["doc-b"] }),
        ],
      }),
    );
    const entries = await listCitations(CACHE_DIR);
    expect(entries).toHaveLength(2);
  });

  it("filters by document", async () => {
    mockFs.readFile.mockResolvedValueOnce(
      JSON.stringify({
        version: 1,
        projectName: "p",
        entries: [
          makeEntry({ documents: ["doc-a"] }),
          makeEntry({ citeKey: "telstra2010", title: "Telstra", documents: ["doc-b"] }),
        ],
      }),
    );
    const entries = await listCitations(CACHE_DIR, "doc-a");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.citeKey).toBe("mabo1992");
  });
});

describe("exportBib", () => {
  it("returns empty string for empty cache", async () => {
    mockFs.readFile.mockRejectedValueOnce(Object.assign(new Error(), { code: "ENOENT" }));
    const bib = await exportBib(CACHE_DIR);
    expect(bib).toBe("");
  });

  it("exports @jurisdiction entry for case type", async () => {
    mockFs.readFile.mockResolvedValueOnce(
      JSON.stringify({ version: 1, projectName: "p", entries: [makeEntry()] }),
    );
    const bib = await exportBib(CACHE_DIR);
    expect(bib).toContain("@jurisdiction{mabo1992,");
    expect(bib).toContain("title");
    expect(bib).toContain("Mabo v Queensland (No 2)");
  });

  it("exports @misc for secondary sources", async () => {
    const entry = makeEntry({ bibType: "misc", citeKey: "bowrey2012" });
    mockFs.readFile.mockResolvedValueOnce(
      JSON.stringify({ version: 1, projectName: "p", entries: [entry] }),
    );
    const bib = await exportBib(CACHE_DIR);
    expect(bib).toContain("@misc{bowrey2012,");
  });

  it("exports multiple entries separated by blank lines", async () => {
    mockFs.readFile.mockResolvedValueOnce(
      JSON.stringify({
        version: 1,
        projectName: "p",
        entries: [makeEntry(), makeEntry({ citeKey: "telstra2010", title: "Telstra Corp Ltd" })],
      }),
    );
    const bib = await exportBib(CACHE_DIR);
    expect(bib).toContain("@jurisdiction{mabo1992,");
    expect(bib).toContain("@jurisdiction{telstra2010,");
    // Two entries separated by blank line
    expect(bib).toMatch(/}\n\n@/);
  });

  it("filters by document", async () => {
    mockFs.readFile.mockResolvedValueOnce(
      JSON.stringify({
        version: 1,
        projectName: "p",
        entries: [
          makeEntry({ documents: ["doc-a"] }),
          makeEntry({ citeKey: "telstra2010", title: "Telstra", documents: ["doc-b"] }),
        ],
      }),
    );
    const bib = await exportBib(CACHE_DIR, "doc-a");
    expect(bib).toContain("mabo1992");
    expect(bib).not.toContain("telstra2010");
  });
});

describe("updateSourceFields", () => {
  it("updates sourceFile, contentHash, and freshness fields", async () => {
    mockFs.readFile.mockResolvedValueOnce(
      JSON.stringify({ version: 1, projectName: "p", entries: [makeEntry()] }),
    );
    await updateSourceFields(CACHE_DIR, "mabo1992", {
      sourceFile: "sources/mabo1992.md",
      contentHash: "abc123",
      sourceFetchedAt: "2026-01-01T00:00:00.000Z",
      sourceEtag: '"etag-value"',
      sourceLastModified: "Wed, 01 Jan 2026 00:00:00 GMT",
    });
    const written = JSON.parse(mockFs.writeFile.mock.calls[0]![1] as string);
    const entry = written.entries[0];
    expect(entry.sourceFile).toBe("sources/mabo1992.md");
    expect(entry.contentHash).toBe("abc123");
    expect(entry.sourceEtag).toBe('"etag-value"');
  });

  it("does nothing when citeKey not found", async () => {
    mockFs.readFile.mockResolvedValueOnce(
      JSON.stringify({ version: 1, projectName: "p", entries: [] }),
    );
    await updateSourceFields(CACHE_DIR, "nonexistent", { contentHash: "x" });
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });
});
