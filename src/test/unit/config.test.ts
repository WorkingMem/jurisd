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

  // transport section (A2)
  it("transport.useImpit defaults to true when env var absent", () => {
    vi.stubEnv("AUSLAW_USE_IMPIT", undefined);
    const cfg = loadConfig();
    expect(cfg.transport.useImpit).toBe(true);
  });

  it("transport.useImpit is false when AUSLAW_USE_IMPIT=false", () => {
    vi.stubEnv("AUSLAW_USE_IMPIT", "false");
    const cfg = loadConfig();
    expect(cfg.transport.useImpit).toBe(false);
  });

  it("transport.imitBrowser defaults to chrome", () => {
    vi.stubEnv("AUSLAW_IMPIT_BROWSER", undefined);
    const cfg = loadConfig();
    expect(cfg.transport.imitBrowser).toBe("chrome");
  });

  it("transport.imitBrowser reads env var correctly", () => {
    vi.stubEnv("AUSLAW_IMPIT_BROWSER", "firefox");
    const cfg = loadConfig();
    expect(cfg.transport.imitBrowser).toBe("firefox");
  });

  // oalc section (B1)
  it("oalc.enabled defaults to true when env var absent", () => {
    vi.stubEnv("AUSLAW_OALC_ENABLED", undefined);
    const cfg = loadConfig();
    expect(cfg.oalc.enabled).toBe(true);
  });

  it("oalc.enabled is false when AUSLAW_OALC_ENABLED=false", () => {
    vi.stubEnv("AUSLAW_OALC_ENABLED", "false");
    const cfg = loadConfig();
    expect(cfg.oalc.enabled).toBe(false);
  });

  it("oalc.source reads AUSLAW_OALC_SOURCE env var", () => {
    vi.stubEnv("AUSLAW_OALC_SOURCE", "/data/corpus.jsonl");
    const cfg = loadConfig();
    expect(cfg.oalc.source).toBe("/data/corpus.jsonl");
  });

  it("oalc.source defaults to oalc-data/corpus_published.jsonl path when env var absent", () => {
    vi.stubEnv("AUSLAW_OALC_SOURCE", undefined);
    const cfg = loadConfig();
    expect(cfg.oalc.source).toContain("oalc-data/corpus_published.jsonl");
  });
});
