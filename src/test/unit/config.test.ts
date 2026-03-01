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
    const cfg = loadConfig();
    expect(cfg.source.sessionCookie).toBeUndefined();
  });
});
