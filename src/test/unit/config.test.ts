import { describe, it, expect, vi, afterEach } from "vitest";
import { loadConfig } from "../../config.js";

describe("loadConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
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

  // austlii section (A3/B2)
  it("austlii.classicRewrite defaults to true when env var absent", () => {
    vi.stubEnv("AUSTLII_CLASSIC_REWRITE", undefined);
    expect(loadConfig().austlii.classicRewrite).toBe(true);
  });

  it("austlii.classicRewrite is false when AUSTLII_CLASSIC_REWRITE=false", () => {
    vi.stubEnv("AUSTLII_CLASSIC_REWRITE", "false");
    expect(loadConfig().austlii.classicRewrite).toBe(false);
  });

  it("austlii.transport defaults to auto when env var absent", () => {
    vi.stubEnv("AUSTLII_TRANSPORT", undefined);
    expect(loadConfig().austlii.transport).toBe("auto");
  });

  it("austlii.transport reads impit/axios but rejects unknown values to auto", () => {
    vi.stubEnv("AUSTLII_TRANSPORT", "impit");
    expect(loadConfig().austlii.transport).toBe("impit");
    vi.stubEnv("AUSTLII_TRANSPORT", "axios");
    expect(loadConfig().austlii.transport).toBe("axios");
    vi.stubEnv("AUSTLII_TRANSPORT", "garbage");
    expect(loadConfig().austlii.transport).toBe("auto");
  });

  it("austlii.cfClearance is undefined when env var absent", () => {
    vi.stubEnv("AUSTLII_CF_CLEARANCE", undefined);
    expect(loadConfig().austlii.cfClearance).toBeUndefined();
  });

  it("austlii.cfClearance reads AUSTLII_CF_CLEARANCE env var", () => {
    vi.stubEnv("AUSTLII_CF_CLEARANCE", "abc123");
    expect(loadConfig().austlii.cfClearance).toBe("abc123");
  });

  it("austlii.accept and acceptLanguage have sensible defaults", () => {
    vi.stubEnv("AUSTLII_ACCEPT", undefined);
    vi.stubEnv("AUSTLII_ACCEPT_LANGUAGE", undefined);
    const cfg = loadConfig();
    expect(cfg.austlii.accept).toContain("text/html");
    expect(cfg.austlii.acceptLanguage).toContain("en-AU");
  });

  it("tavily fallback is opt-in and inactive by default", () => {
    vi.stubEnv("TAVILY_API_KEY", undefined);
    vi.stubEnv("AUSTLII_TAVILY_FALLBACK", undefined);
    const cfg = loadConfig();
    expect(cfg.tavily.apiKey).toBeUndefined();
    expect(cfg.tavily.austliiFallbackEnabled).toBe(false);
    expect(cfg.tavily.searchDepth).toBe("advanced");
    expect(cfg.tavily.maxResults).toBe(10);
  });

  it("tavily config reads explicit fallback settings", () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-test");
    vi.stubEnv("AUSTLII_TAVILY_FALLBACK", "true");
    vi.stubEnv("TAVILY_SEARCH_DEPTH", "basic");
    vi.stubEnv("TAVILY_TIMEOUT", "12345");
    vi.stubEnv("TAVILY_MAX_RESULTS", "99");
    const cfg = loadConfig();
    expect(cfg.tavily.apiKey).toBe("tvly-test");
    expect(cfg.tavily.austliiFallbackEnabled).toBe(true);
    expect(cfg.tavily.searchDepth).toBe("basic");
    expect(cfg.tavily.timeout).toBe(12345);
    expect(cfg.tavily.maxResults).toBe(20);
  });
});
