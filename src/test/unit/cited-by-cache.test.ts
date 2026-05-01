import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFs = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock("node:fs", () => ({
  promises: mockFs,
}));

import {
  updateCitedBy,
  updateCitedBySource,
  type CitedByRef,
} from "../../services/citation-cache.js";

const CACHE_DIR = "/test/project";

function makeCacheJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    projectName: "project",
    entries: [
      {
        citeKey: "mabo1992",
        id: "test-uuid",
        title: "Mabo v Queensland (No 2)",
        neutralCitation: "[1992] HCA 23",
        aglc4Full: "Mabo v Queensland (No 2) [1992] HCA 23",
        url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
        type: "case",
        documents: [],
        footnoteNumbers: {},
        addedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        bibType: "jurisdiction",
        bibFields: {},
        ...overrides,
      },
    ],
  });
}

const SAMPLE_REFS: CitedByRef[] = [
  {
    title: "Wik Peoples v Queensland",
    neutralCitation: "[1996] HCA 40",
    aglc4Full: "Wik Peoples v Queensland [1996] HCA 40",
    url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1996/40.html",
    year: 1996,
    court: "HCA",
  },
  {
    title: "Members of the Yorta Yorta Aboriginal Community v Victoria",
    neutralCitation: "[2002] HCA 58",
    aglc4Full: "Members of the Yorta Yorta Aboriginal Community v Victoria [2002] HCA 58",
    url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/2002/58.html",
    year: 2002,
    court: "HCA",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockFs.mkdir.mockResolvedValue(undefined);
  mockFs.writeFile.mockResolvedValue(undefined);
});

describe("updateCitedBy", () => {
  it("stores citedBy refs and sets citedByFetchedAt", async () => {
    mockFs.readFile.mockResolvedValueOnce(makeCacheJson());

    await updateCitedBy(CACHE_DIR, "mabo1992", SAMPLE_REFS, 42);

    const written = JSON.parse(mockFs.writeFile.mock.calls[0]![1] as string);
    const entry = written.entries[0];
    expect(entry.citedBy).toHaveLength(2);
    expect(entry.citedBy[0].neutralCitation).toBe("[1996] HCA 40");
    expect(entry.citedByFetchedAt).toBeDefined();
    expect(entry.citedByTotalCount).toBe(42);
  });

  it("replaces an existing citedBy array rather than appending", async () => {
    mockFs.readFile.mockResolvedValueOnce(
      makeCacheJson({ citedBy: [{ title: "Old Case", neutralCitation: "[2000] HCA 1" }] }),
    );

    await updateCitedBy(CACHE_DIR, "mabo1992", SAMPLE_REFS, 2);

    const written = JSON.parse(mockFs.writeFile.mock.calls[0]![1] as string);
    expect(written.entries[0].citedBy).toHaveLength(2);
    expect(written.entries[0].citedBy[0].neutralCitation).toBe("[1996] HCA 40");
  });

  it("updates the parent entry's updatedAt timestamp", async () => {
    mockFs.readFile.mockResolvedValueOnce(makeCacheJson());

    await updateCitedBy(CACHE_DIR, "mabo1992", SAMPLE_REFS, 2);

    const written = JSON.parse(mockFs.writeFile.mock.calls[0]![1] as string);
    expect(written.entries[0].updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("does nothing when citeKey is not found", async () => {
    mockFs.readFile.mockResolvedValueOnce(
      JSON.stringify({ version: 1, projectName: "p", entries: [] }),
    );

    await updateCitedBy(CACHE_DIR, "nonexistent", SAMPLE_REFS, 0);

    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it("handles empty refs array (clears prior data)", async () => {
    mockFs.readFile.mockResolvedValueOnce(
      makeCacheJson({ citedBy: SAMPLE_REFS, citedByTotalCount: 2 }),
    );

    await updateCitedBy(CACHE_DIR, "mabo1992", [], 0);

    const written = JSON.parse(mockFs.writeFile.mock.calls[0]![1] as string);
    expect(written.entries[0].citedBy).toHaveLength(0);
    expect(written.entries[0].citedByTotalCount).toBe(0);
  });
});

describe("updateCitedBySource", () => {
  it("updates sourceFile and related fields on a matching CitedByRef", async () => {
    mockFs.readFile.mockResolvedValueOnce(makeCacheJson({ citedBy: SAMPLE_REFS }));

    await updateCitedBySource(CACHE_DIR, "mabo1992", "[1996] HCA 40", {
      sourceFile: "sources/mabo1992_citing_1996_hca_40.md",
      sourceFetchedAt: "2026-01-02T00:00:00.000Z",
      contentHash: "abc123",
      sourceEtag: '"etag-wik"',
      sourceLastModified: "Wed, 01 Jan 2026 00:00:00 GMT",
    });

    const written = JSON.parse(mockFs.writeFile.mock.calls[0]![1] as string);
    const ref = written.entries[0].citedBy[0];
    expect(ref.sourceFile).toBe("sources/mabo1992_citing_1996_hca_40.md");
    expect(ref.contentHash).toBe("abc123");
    expect(ref.sourceEtag).toBe('"etag-wik"');
  });

  it("updates the parent entry's updatedAt timestamp", async () => {
    mockFs.readFile.mockResolvedValueOnce(makeCacheJson({ citedBy: SAMPLE_REFS }));

    await updateCitedBySource(CACHE_DIR, "mabo1992", "[1996] HCA 40", {
      sourceFile: "sources/wik.md",
    });

    const written = JSON.parse(mockFs.writeFile.mock.calls[0]![1] as string);
    expect(written.entries[0].updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("does nothing when parent citeKey is not found", async () => {
    mockFs.readFile.mockResolvedValueOnce(
      JSON.stringify({ version: 1, projectName: "p", entries: [] }),
    );

    await updateCitedBySource(CACHE_DIR, "nonexistent", "[1996] HCA 40", {
      sourceFile: "sources/wik.md",
    });

    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it("does nothing when citedBy array is absent on the parent", async () => {
    mockFs.readFile.mockResolvedValueOnce(makeCacheJson());

    await updateCitedBySource(CACHE_DIR, "mabo1992", "[1996] HCA 40", {
      sourceFile: "sources/wik.md",
    });

    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it("does nothing when the neutralCitation is not found in citedBy", async () => {
    mockFs.readFile.mockResolvedValueOnce(makeCacheJson({ citedBy: SAMPLE_REFS }));

    await updateCitedBySource(CACHE_DIR, "mabo1992", "[9999] HCA 999", {
      sourceFile: "sources/unknown.md",
    });

    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it("only updates the matched ref, leaving others unchanged", async () => {
    mockFs.readFile.mockResolvedValueOnce(makeCacheJson({ citedBy: SAMPLE_REFS }));

    await updateCitedBySource(CACHE_DIR, "mabo1992", "[1996] HCA 40", {
      sourceFile: "sources/wik.md",
    });

    const written = JSON.parse(mockFs.writeFile.mock.calls[0]![1] as string);
    const refs: CitedByRef[] = written.entries[0].citedBy;
    expect(refs[0]!.sourceFile).toBe("sources/wik.md");
    expect(refs[1]!.sourceFile).toBeUndefined();
  });
});

describe("CachedCitation — citedBy fields round-trip", () => {
  it("persists all CitedByRef fields through save and load", async () => {
    const refsWithSource: CitedByRef[] = [
      {
        ...SAMPLE_REFS[0]!,
        sourceFile: "sources/mabo1992_citing_1996_hca_40.md",
        sourceFetchedAt: "2026-01-02T00:00:00.000Z",
        contentHash: "deadbeef",
        sourceEtag: '"etag-wik"',
        sourceLastModified: "Wed, 01 Jan 2026 00:00:00 GMT",
      },
    ];

    mockFs.readFile.mockResolvedValueOnce(
      makeCacheJson({
        citedBy: refsWithSource,
        citedByFetchedAt: "2026-01-02T00:00:00.000Z",
        citedByTotalCount: 500,
      }),
    );

    // Trigger a no-op write to inspect round-trip
    await updateCitedBy(CACHE_DIR, "mabo1992", refsWithSource, 500);

    const written = JSON.parse(mockFs.writeFile.mock.calls[0]![1] as string);
    const entry = written.entries[0];
    expect(entry.citedByTotalCount).toBe(500);
    const ref = entry.citedBy[0];
    expect(ref.contentHash).toBe("deadbeef");
    expect(ref.sourceEtag).toBe('"etag-wik"');
    expect(ref.sourceLastModified).toBe("Wed, 01 Jan 2026 00:00:00 GMT");
  });
});
