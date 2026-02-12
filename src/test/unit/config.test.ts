import { describe, it, expect } from "vitest";
import { loadConfig } from "../../config.js";
import type { Config } from "../../config.js";

describe("loadConfig", () => {
  it("should return a valid config object", () => {
    const cfg: Config = loadConfig();

    expect(cfg).toBeDefined();
    expect(cfg.austlii).toBeDefined();
    expect(cfg.source).toBeDefined();
    expect(cfg.ocr).toBeDefined();
    expect(cfg.defaults).toBeDefined();
  });

  it("should have correct default values", () => {
    const cfg = loadConfig();

    // AustLII defaults
    expect(cfg.austlii.searchBase).toContain("austlii.edu.au");
    expect(cfg.austlii.referer).toContain("austlii.edu.au");
    expect(cfg.austlii.timeout).toBe(60000);

    // source defaults
    expect(cfg.source.baseUrl).toBe("https://removed.invalid");
    expect(cfg.source.timeout).toBe(15000);

    // OCR defaults
    expect(cfg.ocr.language).toBe("eng");
    expect(cfg.ocr.oem).toBe(1);
    expect(cfg.ocr.psm).toBe(3);

    // Search defaults
    expect(cfg.defaults.searchLimit).toBe(10);
    expect(cfg.defaults.maxSearchLimit).toBe(50);
    expect(cfg.defaults.outputFormat).toBe("json");
    expect(cfg.defaults.sortBy).toBe("auto");
  });

  it("should have numeric timeout values", () => {
    const cfg = loadConfig();

    expect(typeof cfg.austlii.timeout).toBe("number");
    expect(typeof cfg.source.timeout).toBe("number");
    expect(cfg.austlii.timeout).toBeGreaterThan(0);
    expect(cfg.source.timeout).toBeGreaterThan(0);
  });

  it("should have non-empty user agent strings", () => {
    const cfg = loadConfig();

    expect(cfg.austlii.userAgent.length).toBeGreaterThan(0);
    expect(cfg.source.userAgent.length).toBeGreaterThan(0);
  });
});
