import { describe, it, expect, vi, afterEach } from "vitest";
import { config } from "../../config.js";
import {
  canonicaliseAustliiUrl,
  searchAustliiViaExa,
  searchAustliiViaExaWithStatus,
} from "../../services/exa.js";
import type { SearchOptions } from "../../services/austlii.js";

const caseOpts: SearchOptions = { type: "case" };
const legisOpts: SearchOptions = { type: "legislation" };

function mockExa(
  results: Array<{ url?: string; title?: string }>,
  ok = true,
  status = 200,
): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => ({ results }),
  }) as unknown as typeof fetch;
}

describe("canonicaliseAustliiUrl", () => {
  it("rewrites any AustLII mirror host to www over https", () => {
    expect(canonicaliseAustliiUrl("http://www4.austlii.edu.au/au/cases/cth/HCA/2018/9.html")).toBe(
      "https://www.austlii.edu.au/au/cases/cth/HCA/2018/9.html",
    );
    expect(canonicaliseAustliiUrl("https://vvv.austlii.edu.au/au/cases/cth/HCA/1996/40.html")).toBe(
      "https://www.austlii.edu.au/au/cases/cth/HCA/1996/40.html",
    );
    expect(canonicaliseAustliiUrl("https://summerland.austlii.edu.au/au/legis/cth/x.html")).toBe(
      "https://www.austlii.edu.au/au/legis/cth/x.html",
    );
  });

  it("accepts the bare apex host", () => {
    expect(canonicaliseAustliiUrl("http://austlii.edu.au/au/cases/cth/HCA/2019/33.html")).toBe(
      "https://www.austlii.edu.au/au/cases/cth/HCA/2019/33.html",
    );
  });

  it("returns null for non-AustLII URLs and a look-alike domain", () => {
    expect(canonicaliseAustliiUrl("https://example.com/foo")).toBeNull();
    expect(canonicaliseAustliiUrl("https://austlii.edu.au.evil.com/x")).toBeNull();
    expect(canonicaliseAustliiUrl("not a url")).toBeNull();
  });
});

describe("searchAustliiViaExa", () => {
  const realFetch = globalThis.fetch;
  const realKey = config.exa.apiKey;
  const realSearchType = config.exa.searchType;

  afterEach(() => {
    globalThis.fetch = realFetch;
    config.exa.apiKey = realKey;
    config.exa.searchType = realSearchType;
    vi.restoreAllMocks();
  });

  it("returns [] and makes no request when no API key is configured", async () => {
    config.exa.apiKey = undefined;
    const f = vi.fn();
    globalThis.fetch = f as unknown as typeof fetch;
    const out = await searchAustliiViaExa("Mabo v Queensland", caseOpts, 5);
    expect(out).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it("maps Exa results to canonical AustLII case SearchResults", async () => {
    config.exa.apiKey = "test-key";
    globalThis.fetch = mockExa([
      {
        url: "https://www4.austlii.edu.au/au/cases/cth/HCA/2018/9.html",
        title: "Pike v Tighe [2018] HCA 9",
      },
    ]);
    const out = await searchAustliiViaExa("Pike v Tighe", caseOpts, 5);
    expect(out).toHaveLength(1);
    expect(out[0]!.url).toBe("https://www.austlii.edu.au/au/cases/cth/HCA/2018/9.html");
    expect(out[0]!.source).toBe("austlii");
    expect(out[0]!.discoverySource).toBe("exa-fallback");
    expect(out[0]!.neutralCitation).toBe("[2018] HCA 9");
    expect(out[0]!.type).toBe("case");
  });

  it("drops journals/non-case results when type is case", async () => {
    config.exa.apiKey = "test-key";
    globalThis.fetch = mockExa([
      { url: "https://www.austlii.edu.au/au/journals/UNSWLawJl/1997/30.html", title: "Commentary" },
      {
        url: "https://www.austlii.edu.au/au/cases/cth/HCA/2019/33.html",
        title: "Connective Services [2019] HCA 33",
      },
    ]);
    const out = await searchAustliiViaExa("Connective Services", caseOpts, 5);
    expect(out.map((r) => r.url)).toEqual([
      "https://www.austlii.edu.au/au/cases/cth/HCA/2019/33.html",
    ]);
  });

  it("filters to legislation when type is legislation", async () => {
    config.exa.apiKey = "test-key";
    globalThis.fetch = mockExa([
      { url: "https://www.austlii.edu.au/au/cases/cth/HCA/2019/33.html", title: "a case" },
      { url: "https://www.austlii.edu.au/au/legis/cth/consol_act/foo.html", title: "An Act" },
    ]);
    const out = await searchAustliiViaExa("foo act", legisOpts, 5);
    expect(out.map((r) => r.url)).toEqual([
      "https://www.austlii.edu.au/au/legis/cth/consol_act/foo.html",
    ]);
  });

  it("filters Exa results to the requested jurisdiction", async () => {
    config.exa.apiKey = "test-key";
    globalThis.fetch = mockExa([
      {
        url: "https://www.austlii.edu.au/au/cases/nsw/NSWCA/2018/9.html",
        title: "State result [2018] NSWCA 9",
      },
      {
        url: "https://www.austlii.edu.au/au/cases/cth/HCA/2018/9.html",
        title: "Federal result [2018] HCA 9",
      },
    ]);
    const out = await searchAustliiViaExa(
      "federal result",
      { type: "case", jurisdiction: "cth" },
      5,
    );
    expect(out.map((r) => r.url)).toEqual([
      "https://www.austlii.edu.au/au/cases/cth/HCA/2018/9.html",
    ]);
  });

  it("dedupes mirror hosts that canonicalise to the same URL", async () => {
    config.exa.apiKey = "test-key";
    globalThis.fetch = mockExa([
      {
        url: "https://www4.austlii.edu.au/au/cases/cth/HCA/2018/34.html",
        title: "Hossain [2018] HCA 34",
      },
      {
        url: "https://vvv.austlii.edu.au/au/cases/cth/HCA/2018/34.html",
        title: "Hossain (mirror)",
      },
    ]);
    const out = await searchAustliiViaExa("Hossain", caseOpts, 5);
    expect(out).toHaveLength(1);
  });

  it("returns [] on a non-200 Exa response", async () => {
    config.exa.apiKey = "test-key";
    globalThis.fetch = mockExa([], false, 401);
    const out = await searchAustliiViaExa("x", caseOpts, 5);
    expect(out).toEqual([]);
  });

  it("reports failed Exa status on a non-200 response", async () => {
    config.exa.apiKey = "test-key";
    globalThis.fetch = mockExa([], false, 401);
    const out = await searchAustliiViaExaWithStatus("x", caseOpts, 5);
    expect(out).toEqual({ results: [], status: "failed" });
  });

  it("returns [] when fetch throws", async () => {
    config.exa.apiKey = "test-key";
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network")) as unknown as typeof fetch;
    const out = await searchAustliiViaExa("x", caseOpts, 5);
    expect(out).toEqual([]);
  });

  it("reports not_configured Exa status without an API key", async () => {
    config.exa.apiKey = undefined;
    const f = vi.fn();
    globalThis.fetch = f as unknown as typeof fetch;
    const out = await searchAustliiViaExaWithStatus("x", caseOpts, 5);
    expect(out).toEqual({ results: [], status: "not_configured" });
    expect(f).not.toHaveBeenCalled();
  });

  it("normalises legacy Exa search type values to a supported API value", async () => {
    config.exa.apiKey = "test-key";
    config.exa.searchType = "neural";
    globalThis.fetch = mockExa([]);

    await searchAustliiViaExaWithStatus("x", caseOpts, 5);

    const body = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body));
    expect(body.type).toBe("auto");
  });

  it("respects the result limit", async () => {
    config.exa.apiKey = "test-key";
    globalThis.fetch = mockExa([
      { url: "https://www.austlii.edu.au/au/cases/cth/HCA/2018/1.html", title: "a [2018] HCA 1" },
      { url: "https://www.austlii.edu.au/au/cases/cth/HCA/2018/2.html", title: "b [2018] HCA 2" },
      { url: "https://www.austlii.edu.au/au/cases/cth/HCA/2018/3.html", title: "c [2018] HCA 3" },
    ]);
    const out = await searchAustliiViaExa("x", caseOpts, 2);
    expect(out).toHaveLength(2);
  });
});
