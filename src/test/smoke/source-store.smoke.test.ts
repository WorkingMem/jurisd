/**
 * Smoke tests for source-store functions.
 * Network tests are skipped in CI.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkSourceFreshness, storeSource } from "../../services/source-store.js";

const CI = !!process.env.CI;
const MABO_URL = "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html";

describe("checkSourceFreshness", () => {
  it.skipIf(CI)(
    "returns fresh:false for AustLII URL without prior ETags (always stale on first check)",
    async () => {
      const result = await checkSourceFreshness(MABO_URL);
      expect(result.fresh).toBe(false);
    },
    15_000,
  );
});

describe("storeSource", () => {
  it.skipIf(CI)(
    "downloads and writes a markdown source file",
    async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "auslaw-smoke-"));
      try {
        const result = await storeSource("mabo1992", MABO_URL, null, tmpDir);
        expect(result.changed).toBe(true);
        expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
        expect(result.path).toBe(path.join(tmpDir, "mabo1992.md"));

        const content = await fs.readFile(result.path, "utf-8");
        expect(content).toContain("Mabo");
        expect(content).toContain(`> Source: ${MABO_URL}`);
      } finally {
        await fs.rm(tmpDir, { recursive: true });
      }
    },
    30_000,
  );

  it.skipIf(CI)(
    "returns changed:false on second download when content hash matches",
    async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "auslaw-smoke-"));
      try {
        const first = await storeSource("mabo1992", MABO_URL, null, tmpDir);
        expect(first.changed).toBe(true);

        const second = await storeSource(
          "mabo1992",
          MABO_URL,
          { contentHash: first.contentHash },
          tmpDir,
        );
        expect(second.changed).toBe(false);
        expect(second.contentHash).toBe(first.contentHash);
      } finally {
        await fs.rm(tmpDir, { recursive: true });
      }
    },
    60_000,
  );
});
