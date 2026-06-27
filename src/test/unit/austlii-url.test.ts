import { describe, it, expect } from "vitest";
import {
  isAustliiUrl,
  toWwwUrl,
  toClassicUrl,
  toClassicDocUrl,
  austliiUrlToNeutralCitation,
  austliiUrlIsLegislation,
  normaliseAustliiPath,
  AUSTLII_WWW_HOST,
  AUSTLII_CLASSIC_HOST,
} from "../../services/austlii-url.js";
import { COURT_TO_AUSTLII_PATH } from "../../constants.js";

describe("isAustliiUrl", () => {
  it("returns true for www.austlii.edu.au URLs", () => {
    expect(isAustliiUrl("https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html")).toBe(true);
  });

  it("returns true for classic.austlii.edu.au URLs", () => {
    expect(isAustliiUrl("https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html")).toBe(true);
  });

  it("returns false for non-AustLII URLs", () => {
    expect(isAustliiUrl("https://example.com/doc/12345")).toBe(false);
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
    const external = "https://example.com/doc/12345";
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
    const external = "https://example.com/doc/12345";
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

describe("toClassicDocUrl", () => {
  it("rewrites www to classic and strips the /cgi-bin/viewdoc/ viewer prefix", () => {
    const www = "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html";
    expect(toClassicDocUrl(www)).toBe(
      "https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
    );
  });

  it("rewrites a direct www path to classic without altering the path", () => {
    const www = "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html";
    expect(toClassicDocUrl(www)).toBe(
      "https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
    );
  });

  it("strips the viewer prefix on a classic URL", () => {
    const classic = "https://classic.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html";
    expect(toClassicDocUrl(classic)).toBe(
      "https://classic.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
    );
  });

  it("leaves non-AustLII URLs unchanged", () => {
    const external = "https://example.com/doc/12345";
    expect(toClassicDocUrl(external)).toBe(external);
  });

  it("returns the input unchanged for malformed URLs", () => {
    expect(toClassicDocUrl("not a url")).toBe("not a url");
  });
});

describe("austliiUrlToNeutralCitation", () => {
  it("derives a neutral citation from a direct case URL", () => {
    expect(
      austliiUrlToNeutralCitation("https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html"),
    ).toBe("[1992] HCA 23");
  });

  it("derives from a /cgi-bin/viewdoc/ case URL", () => {
    expect(
      austliiUrlToNeutralCitation(
        "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
      ),
    ).toBe("[1992] HCA 23");
  });

  it("derives from an NZ case URL", () => {
    expect(
      austliiUrlToNeutralCitation("https://www.austlii.edu.au/nz/cases/NZSC/2020/5.html"),
    ).toBe("[2020] NZSC 5");
  });

  it("round-trips every court in COURT_TO_AUSTLII_PATH", () => {
    for (const [court, path] of Object.entries(COURT_TO_AUSTLII_PATH)) {
      const url = `https://www.austlii.edu.au/${path}/2021/7.html`;
      expect(austliiUrlToNeutralCitation(url)).toBe(`[2021] ${court} 7`);
    }
  });

  it("returns null for a legislation URL", () => {
    expect(
      austliiUrlToNeutralCitation(
        "https://www.austlii.edu.au/au/legis/cth/consol_act/paa1988125.html",
      ),
    ).toBeNull();
  });

  it("returns null for an unknown court code", () => {
    expect(
      austliiUrlToNeutralCitation("https://www.austlii.edu.au/au/cases/cth/XYZ/2021/1.html"),
    ).toBeNull();
  });

  it("returns null for a malformed URL", () => {
    expect(austliiUrlToNeutralCitation("not a url")).toBeNull();
  });
});

describe("austliiUrlIsLegislation", () => {
  it("returns true for a /legis/ URL", () => {
    expect(
      austliiUrlIsLegislation("https://www.austlii.edu.au/au/legis/cth/consol_act/paa1988125.html"),
    ).toBe(true);
  });

  it("returns false for a /cases/ URL", () => {
    expect(
      austliiUrlIsLegislation("https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html"),
    ).toBe(false);
  });

  it("returns false for a malformed URL", () => {
    expect(austliiUrlIsLegislation("not a url")).toBe(false);
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
