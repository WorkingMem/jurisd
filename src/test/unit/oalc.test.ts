import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { lookupByUrl, lookupByCitation, resetConnection } from "../../services/oalc.js";

// vi.mock is hoisted before imports. vi.hoisted() allows us to compute values
// that the mock factory needs. We use URL.pathname directly (POSIX-safe on
// macOS/Linux) rather than fileURLToPath to avoid an import in the hoisted fn.
const { fixturePath } = vi.hoisted(() => {
  const url = new URL("../fixtures/oalc-fixture.jsonl", import.meta.url);
  return { fixturePath: url.pathname };
});

vi.mock("../../config.js", () => ({
  config: {
    oalc: {
      source: fixturePath,
      enabled: true,
    },
    transport: { useImpit: false, imitBrowser: "chrome" },
  },
}));

describe("OALC corpus lookup", () => {
  beforeEach(() => {
    resetConnection();
  });

  afterEach(() => {
    resetConnection();
  });

  describe("lookupByUrl", () => {
    it("finds a document by its canonical URL", async () => {
      const doc = await lookupByUrl("https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html");
      expect(doc).not.toBeNull();
      expect(doc!.citation).toBe("Mabo v Queensland (No 2) [1992] HCA 23");
    });

    it("returns null for a URL not in the corpus", async () => {
      const doc = await lookupByUrl("https://www.austlii.edu.au/au/cases/cth/HCA/9999/99.html");
      expect(doc).toBeNull();
    });

    it("populates all required OalcDocument fields", async () => {
      const doc = await lookupByUrl("https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html");
      expect(doc).not.toBeNull();
      expect(doc!.version_id).toBeTruthy();
      expect(doc!.type).toBe("decision");
      expect(doc!.jurisdiction).toBe("commonwealth");
      expect(doc!.source).toBe("high_court_of_australia");
      expect(doc!.mime).toBe("text/html");
      expect(doc!.date).toBe("1992-06-03");
      expect(doc!.url).toBe("https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html");
      expect(doc!.when_scraped).toBeTruthy();
      expect(doc!.text).toContain("Mabo");
    });

    it("finds a legislation document by URL", async () => {
      const doc = await lookupByUrl("https://www.legislation.gov.au/C2010A00051/latest/text");
      expect(doc).not.toBeNull();
      expect(doc!.type).toBe("primary_legislation");
    });
  });

  describe("lookupByCitation", () => {
    it("finds a document by exact citation string", async () => {
      const doc = await lookupByCitation("Mabo v Queensland (No 2) [1992] HCA 23");
      expect(doc).not.toBeNull();
      expect(doc!.url).toBe("https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html");
    });

    it("returns null for a citation not in the corpus", async () => {
      const doc = await lookupByCitation("Fictional v Case [9999] XYZ 1");
      expect(doc).toBeNull();
    });

    it("returns null for a partial/normalised citation when exact match fails", async () => {
      const doc = await lookupByCitation("mabo v queensland (no 2) [1992] hca 23");
      expect(doc).toBeNull();
    });

    it("finds a legislation document by citation", async () => {
      const doc = await lookupByCitation("Competition and Consumer Act 2010 (Cth)");
      expect(doc).not.toBeNull();
      expect(doc!.type).toBe("primary_legislation");
    });

    it("matches a neutral-citation token via substring when isLegis=false", async () => {
      const doc = await lookupByCitation("[1992] HCA 23", false);
      expect(doc).not.toBeNull();
      expect(doc!.citation).toBe("Mabo v Queensland (No 2) [1992] HCA 23");
      expect(doc!.type).toBe("decision");
    });

    it("constrains a decision substring match to type='decision'", async () => {
      // The legislation row's citation does not contain a neutral citation, so
      // a decision-token lookup must not return it.
      const doc = await lookupByCitation("[1992] HCA 23", false);
      expect(doc!.type).toBe("decision");
    });

    it("returns null for a neutral-citation token not in the corpus", async () => {
      const doc = await lookupByCitation("[9999] XYZ 1", false);
      expect(doc).toBeNull();
    });

    it("matches legislation via substring when isLegis=true (no decision type guard)", async () => {
      const doc = await lookupByCitation("Competition and Consumer Act 2010", true);
      expect(doc).not.toBeNull();
      expect(doc!.type).toBe("primary_legislation");
    });
  });

  describe("disabled state", () => {
    it("returns null when oalc.enabled is false", async () => {
      const { config } = await import("../../config.js");
      const savedEnabled = config.oalc.enabled;
      config.oalc.enabled = false;
      try {
        const doc = await lookupByUrl("https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html");
        expect(doc).toBeNull();
      } finally {
        config.oalc.enabled = savedEnabled;
      }
    });
  });
});
