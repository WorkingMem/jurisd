import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import axios from "axios";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

vi.mock("axios");

const mockConfig = vi.hoisted(() => ({
  jade: {
    userAgent: "test-agent",
    timeout: 5000,
    sessionCookie: undefined as string | undefined,
    baseUrl: "https://jade.io",
  },
  austlii: { searchBase: "", referer: "", userAgent: "", timeout: 5000 },
  defaults: {
    searchLimit: 10,
    maxSearchLimit: 50,
    outputFormat: "json",
    sortBy: "auto",
  },
}));

vi.mock("../../config.js", () => ({ config: mockConfig }));
vi.mock("../../utils/rate-limiter.js", () => ({
  jadeRateLimiter: { throttle: vi.fn().mockResolvedValue(undefined) },
  austliiRateLimiter: { throttle: vi.fn().mockResolvedValue(undefined) },
}));

import { searchCitingCases } from "../../services/jade.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
function readFixture(name: string): string {
  return readFileSync(join(__dirname, "../fixtures", name), "utf-8");
}

describe("searchCitingCases", () => {
  beforeEach(() => {
    vi.mocked(axios.isAxiosError).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockConfig.jade.sessionCookie = undefined;
  });

  it("returns empty results when no session cookie is configured", async () => {
    const result = await searchCitingCases("Mabo v Queensland (No 2)");
    expect(result.results).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it("calls proposeCitables then jadeService.do (citator) in sequence", async () => {
    mockConfig.jade.sessionCookie = "IID=abc; alcsessionid=xyz";

    vi.mocked(axios.post)
      .mockResolvedValueOnce({ data: readFixture("propose-citables-mabo.txt"), status: 200 })
      .mockResolvedValueOnce({ data: readFixture("citator-mabo.txt"), status: 200 });

    await searchCitingCases("Mabo v Queensland (No 2)");

    expect(axios.post).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = vi.mocked(axios.post).mock.calls;
    expect(firstCall?.[1]).toContain("proposeCitables");
    expect(secondCall?.[1]).toContain("LeftoverRemoteService");
    expect(secondCall?.[1]).toContain("JZd2"); // citable ID for Mabo
  });

  it("returns citing cases from the citator response", async () => {
    mockConfig.jade.sessionCookie = "IID=abc; alcsessionid=xyz";

    vi.mocked(axios.post)
      .mockResolvedValueOnce({ data: readFixture("propose-citables-mabo.txt"), status: 200 })
      .mockResolvedValueOnce({ data: readFixture("citator-mabo.txt"), status: 200 });

    const { results } = await searchCitingCases("Mabo v Queensland (No 2)");

    expect(results.length).toBeGreaterThan(0);
    const stuart = results.find((r) => r.neutralCitation === "[2025] HCA 12");
    expect(stuart).toBeDefined();
    expect(stuart!.caseName).toContain("Stuart");
    expect(stuart!.jadeUrl).toBe("https://jade.io/article/1127773");
  });

  it("returns the correct totalCount from the citator response", async () => {
    mockConfig.jade.sessionCookie = "IID=abc; alcsessionid=xyz";

    vi.mocked(axios.post)
      .mockResolvedValueOnce({ data: readFixture("propose-citables-mabo.txt"), status: 200 })
      .mockResolvedValueOnce({ data: readFixture("citator-mabo.txt"), status: 200 });

    const { totalCount } = await searchCitingCases("Mabo v Queensland (No 2)");

    expect(totalCount).toBe(695);
  });

  it("returns empty on proposeCitables network error (graceful degradation)", async () => {
    mockConfig.jade.sessionCookie = "IID=abc";
    vi.mocked(axios.post).mockRejectedValueOnce(new Error("timeout"));

    const result = await searchCitingCases("Mabo v Queensland (No 2)");
    expect(result.results).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it("returns empty if no citable IDs found in proposeCitables response", async () => {
    mockConfig.jade.sessionCookie = "IID=abc";
    // Minimal proposeCitables response with no citable IDs in valid range
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: "//OK[[],[],4,7]",
      status: 200,
    });

    const result = await searchCitingCases("Unknown Case");
    expect(result.results).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it("does not expose session cookie in error messages on AxiosError", async () => {
    mockConfig.jade.sessionCookie = "IID=secret123; alcsessionid=abc456";
    const axiosError = Object.assign(new Error("Network Error"), {
      isAxiosError: true,
      config: { headers: { Cookie: "IID=secret123; alcsessionid=abc456" } },
      response: undefined,
    });
    vi.mocked(axios.post).mockRejectedValueOnce(axiosError);
    vi.mocked(axios.isAxiosError).mockReturnValue(true);

    const result = await searchCitingCases("test case");
    expect(result.results).toEqual([]);
    expect(result.totalCount).toBe(0);
  });
});
