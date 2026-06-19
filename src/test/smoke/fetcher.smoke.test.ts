/**
 * Smoke tests for fetchDocumentText.
 * Network tests are skipped unless explicitly enabled.
 */
import { describe, it, expect } from "vitest";
import { fetchDocumentText } from "../../services/fetcher.js";

const RUN_LIVE_AUSTLII = process.env.JURISD_RUN_LIVE_AUSTLII === "1";

describe("fetchDocumentText", () => {
  it.skipIf(!RUN_LIVE_AUSTLII)(
    "fetches an AustLII HTML page and returns text",
    async () => {
      const result = await fetchDocumentText(
        "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
      );
      expect(result.text).toContain("Mabo");
      expect(result.contentType).toMatch(/text\/html/);
      expect(result.sourceUrl).toContain("HCA/1992/23");
    },
    30_000,
  );

  it.skipIf(!RUN_LIVE_AUSTLII)(
    "fetches a legislation page from AustLII",
    async () => {
      const result = await fetchDocumentText(
        "https://www.austlii.edu.au/cgi-bin/viewdoc/au/legis/cth/consol_act/pa1988108/",
      );
      expect(result.text).toBeTruthy();
      expect(result.contentType).toMatch(/text\/html/);
    },
    30_000,
  );
});
