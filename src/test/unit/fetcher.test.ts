import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { fileTypeFromBuffer } from "file-type";

vi.mock("file-type");

// AustLII routes through the impit transport seam; mock it so these tests stay
// offline and don't touch the impit native binary.
const { austliiGetMock } = vi.hoisted(() => ({ austliiGetMock: vi.fn() }));
vi.mock("../../services/transport.js", () => ({
  fetcherForUrl: vi.fn(() => ({ get: austliiGetMock })),
}));
vi.mock("../../services/cloudflare.js", () => ({
  isCloudflareChallenge: vi.fn().mockReturnValue(false),
}));

const mockConfig = vi.hoisted(() => ({
  austlii: {
    searchBase: "",
    referer: "",
    userAgent: "test-austlii-ua",
    timeout: 5000,
    transport: "auto" as const,
    classicRewrite: true,
    cfClearance: undefined as string | undefined,
    accept: "text/html",
    acceptLanguage: "en-AU,en;q=0.9",
  },
  oalc: { enabled: true, source: "/tmp/fixture.jsonl" },
  transport: { useImpit: false, imitBrowser: "chrome" },
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts paragraph blocks from AustLII HTML with [N] markers", async () => {
    const html = `<html><body>
      <p>[1] First paragraph text here.</p>
      <p>[2] Second paragraph about duty of care.</p>
      <p>[3] Third paragraph concluding.</p>
    </body></html>`;

    austliiGetMock.mockResolvedValueOnce({
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from(html),
      finalUrl: "https://www.austlii.edu.au/case",
      via: "impit",
    });

    const result = await fetchDocumentText("https://www.austlii.edu.au/case");
    expect(result.paragraphs).toBeDefined();
    const paras = result.paragraphs!;
    expect(paras.length).toBe(3);
    expect(paras[1]!.number).toBe(2);
    expect(paras[1]!.text).toContain("duty of care");
  });
});
