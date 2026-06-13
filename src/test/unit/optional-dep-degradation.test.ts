import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  setModulesRootForTest,
  discoverModules,
  listDataModules,
  semanticSearchLocal,
} from "../../services/modules.js";
import { resetEmbedder, isEmbedderAvailable } from "../../services/embedder.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "../fixtures/modules");

function installFixture(root: string, name: string): void {
  const src = path.join(FIXTURES, name);
  const dst = path.join(root, name);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
  }
}

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "wse-optdep-"));
  setModulesRootForTest(root, true);
  resetEmbedder();
});
afterEach(() => {
  setModulesRootForTest(null);
  resetEmbedder();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("optional-dependency absence degrades with typed signals", () => {
  it("the local embedder dependency is genuinely absent in this environment", async () => {
    // This whole suite asserts the REAL absence path; guard the premise.
    expect(await isEmbedderAvailable()).toBe(false);
  });

  it("semantic_search_local degrades to a typed note when the embedder is absent (no throw)", async () => {
    installFixture(root, "fixture-embedded");
    discoverModules(true);
    resetEmbedder(); // ensure no injected fake; hit the real tryLoadTransformers path
    const r = await semanticSearchLocal({ query: "misleading conduct" });
    expect(r.found).toBe(false);
    expect(r.hits).toEqual([]);
    expect(r.notes.length).toBeGreaterThan(0);
    // The note names the missing dependency and the disabled feature.
    expect(r.notes.some((n) => /transformers|embedder/i.test(n))).toBe(true);
  });

  it("list_data_modules works with no DuckDB attach (metadata-only path)", () => {
    installFixture(root, "fixture");
    // No discover/attach needed; the registry metadata view is independent of DuckDB.
    const list = listDataModules({ refresh: true });
    expect(list).toHaveLength(1);
    expect(list[0]!.status).toBe("ready");
  });

  it("semantic_search_local never throws even with no modules installed", async () => {
    discoverModules(true);
    resetEmbedder();
    const r = await semanticSearchLocal({ query: "anything" });
    expect(r.found).toBe(false);
    expect(Array.isArray(r.notes)).toBe(true);
  });
});
