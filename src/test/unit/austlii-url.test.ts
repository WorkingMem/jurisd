import { describe, it, expect } from "vitest";
import {
  isAustliiUrl,
  toWwwUrl,
  toClassicUrl,
  normaliseAustliiPath,
  AUSTLII_WWW_HOST,
  AUSTLII_CLASSIC_HOST,
} from "../../services/austlii-url.js";

describe("isAustliiUrl", () => {
  it("returns true for www.austlii.edu.au URLs", () => {
    expect(isAustliiUrl("https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html")).toBe(true);
  });

  it("returns true for classic.austlii.edu.au URLs", () => {
    expect(isAustliiUrl("https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html")).toBe(true);
  });

  it("returns false for non-AustLII URLs", () => {
    expect(isAustliiUrl("https://removed.invalid/article/12345")).toBe(false);
    expect(isAustliiUrl("https://legislation.gov.au/C2010A00051")).toBe(false);
  });

  it("returns false for malformed strings", () => {
    expect(isAustliiUrl("not a url")).toBe(false);
    expect(isAustliiUrl("")).toBe(false);
  });
});

describe("toWwwUrl", () => {
  it("rewrites classic host to www", () => {
    const classic = "https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html";
    const expected = "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html";
    expect(toWwwUrl(classic)).toBe(expected);
  });

  it("leaves www URLs unchanged", () => {
    const www = "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html";
    expect(toWwwUrl(www)).toBe(www);
  });

  it("leaves non-AustLII URLs unchanged", () => {
    const external = "https://removed.invalid/article/12345";
    expect(toWwwUrl(external)).toBe(external);
  });

  it("preserves path, query string and fragment", () => {
    const classic = "https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html?foo=bar#section";
    const result = toWwwUrl(classic);
    expect(result).toContain(AUSTLII_WWW_HOST);
    expect(result).toContain("foo=bar");
    expect(result).toContain("#section");
  });

  it("returns the input unchanged for malformed URLs", () => {
    const bad = "not a url";
    expect(toWwwUrl(bad)).toBe(bad);
  });
});

describe("toClassicUrl", () => {
  it("rewrites www host to classic", () => {
    const www = "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html";
    const expected = "https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html";
    expect(toClassicUrl(www)).toBe(expected);
  });

  it("leaves classic URLs unchanged", () => {
    const classic = "https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html";
    expect(toClassicUrl(classic)).toBe(classic);
  });

  it("leaves non-AustLII URLs unchanged", () => {
    const external = "https://removed.invalid/article/12345";
    expect(toClassicUrl(external)).toBe(external);
  });

  it("preserves path and query string", () => {
    const www = "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html?stem=0";
    const result = toClassicUrl(www);
    expect(result).toContain(AUSTLII_CLASSIC_HOST);
    expect(result).toContain("stem=0");
  });

  it("returns the input unchanged for malformed URLs", () => {
    const bad = "not a url";
    expect(toClassicUrl(bad)).toBe(bad);
  });
});

describe("normaliseAustliiPath", () => {
  it("prepends www origin for absolute paths", () => {
    const path = "/au/cases/cth/HCA/1992/23.html";
    expect(normaliseAustliiPath(path)).toBe(
      `https://${AUSTLII_WWW_HOST}/au/cases/cth/HCA/1992/23.html`,
    );
  });

  it("rewrites classic URLs to www", () => {
    const classic = "https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html";
    expect(normaliseAustliiPath(classic)).toBe(
      "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
    );
  });

  it("leaves www URLs unchanged", () => {
    const www = "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html";
    expect(normaliseAustliiPath(www)).toBe(www);
  });

  it("leaves non-AustLII URLs unchanged", () => {
    const external = "https://legislation.gov.au/C2010A00051";
    expect(normaliseAustliiPath(external)).toBe(external);
  });
});
