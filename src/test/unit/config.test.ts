import { describe, it, expect, vi, afterEach } from "vitest";
import { loadConfig } from "../../config.js";

describe("loadConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads SESSION_COOKIE from env", () => {
    vi.stubEnv("SESSION_COOKIE", "test-cookie-value");
    const cfg = loadConfig();
    expect(cfg.source.sessionCookie).toBe("test-cookie-value");
  });

  it("sessionCookie is undefined when env var absent", () => {
    vi.stubEnv("SESSION_COOKIE", undefined);
    const cfg = loadConfig();
    expect(cfg.source.sessionCookie).toBeUndefined();
  });

  it("citedBy.downloadLimit defaults to 5 when env var is non-numeric", () => {
    vi.stubEnv("AUSLAW_CITED_BY_DOWNLOAD_LIMIT", "abc");
    const cfg = loadConfig();
    expect(cfg.citedBy.downloadLimit).toBe(5);
  });

  it("citedBy.downloadLimit reads numeric env var correctly", () => {
    vi.stubEnv("AUSLAW_CITED_BY_DOWNLOAD_LIMIT", "10");
    const cfg = loadConfig();
    expect(cfg.citedBy.downloadLimit).toBe(10);
  });
});
