import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  setModulesRootForTest,
  discoverModules,
  tryLoadDuckDB,
  getProvision,
  getActStructure,
  findCiting,
  semanticSearchLocal,
  listDataModules,
} from "../../services/modules.js";
import { setQueryEmbedderForTest, resetEmbedder, isEmbedderAvailable } from "../../services/embedder.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "../fixtures/modules");
const duckdbAvailable = (await tryLoadDuckDB()) !== null;
// The "no embedder present" degradation test can only hold when the optional
// embedder is genuinely absent (as in CI); skip it where it is installed.
const embedderPresent = await isEmbedderAvailable();

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
  root = fs.mkdtempSync(path.join(os.tmpdir(), "wse-shapes-"));
  setModulesRootForTest(root, true);
  resetEmbedder();
});
afterEach(() => {
  setModulesRootForTest(null);
  resetEmbedder();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("recall tools — shapes on the vendored fixture", () => {
  it("list_data_modules returns the metadata summary with no DuckDB attach", () => {
    installFixture(root, "fixture");
    const list = listDataModules({ refresh: true });
    expect(list).toHaveLength(1);
    const m = list[0]!;
    expect(m.name).toBe("fixture");
    expect(m.status).toBe("ready");
    expect(m.jurisdictions).toEqual(["commonwealth"]);
    expect(m.doc_count).toBe(2);
    expect(m.chunk_count).toBe(3);
    expect(m.embedding).toBeNull();
    expect(typeof m.snapshot_date).toBe("string");
    expect(m.stale).toBe(false); // fixture snapshot is recent, under the 365-day threshold
  });

  it.skipIf(!duckdbAvailable)(
    "get_provision returns a single deterministic chunk + metadata",
    async () => {
      installFixture(root, "fixture");
      discoverModules(true);
      const r = await getProvision({
        act: "Competition and Consumer Act 2010 (Cth)",
        provision: "s 18",
      });
      expect(r.found).toBe(true);
      if (!r.found) return;
      expect(r.provision_ref).toBe("s 18");
      expect(r.text).toContain("misleading");
      expect(typeof r.char_start).toBe("number");
      expect(r.metadata.source).toBe("local_module");
      expect(r.metadata.name).toBe("fixture");
      expect(r.metadata.module_version).toBeTruthy();
    },
  );

  it.skipIf(!duckdbAvailable)(
    "get_provision returns {found:false} on a miss (typed, not thrown)",
    async () => {
      installFixture(root, "fixture");
      discoverModules(true);
      const r = await getProvision({
        act: "Competition and Consumer Act 2010 (Cth)",
        provision: "s 999",
      });
      expect(r.found).toBe(false);
    },
  );

  it.skipIf(!duckdbAvailable)("get_act_structure returns a nested containment tree", async () => {
    installFixture(root, "fixture");
    discoverModules(true);
    const r = await getActStructure({ act: "Competition and Consumer Act 2010 (Cth)" });
    expect(r.found).toBe(true);
    expect(r.root).toBeDefined();
    expect(r.root!.parent_id).toBeNull();
    expect(r.root!.depth).toBe(0);
    expect(Array.isArray(r.root!.children)).toBe(true);
    expect(r.metadata?.source).toBe("local_module");
  });

  it.skipIf(!duckdbAvailable)(
    "find_citing returns citing hits with provenance + per-module metadata",
    async () => {
      installFixture(root, "fixture");
      discoverModules(true);
      // Fixture has one cites edge: Mabo → ACL s 18. So the ACL is the cited
      // target; Mabo is the citing document returned with its provenance span.
      const r = await findCiting({ target: "Competition and Consumer Act 2010 (Cth)" });
      expect(r.found).toBe(true);
      expect(r.hits.length).toBeGreaterThan(0);
      const hit = r.hits[0]!;
      expect(hit.citation).toBe("Mabo v Queensland (No 2) [1992] HCA 23");
      expect(["cites", "considers"]).toContain(hit.kind);
      expect(hit.metadata.source).toBe("local_module");
      expect(hit.metadata.name).toBe("fixture");
    },
  );

  it.skipIf(!duckdbAvailable)(
    "semantic_search_local ranks the known query vector correctly",
    async () => {
      installFixture(root, "fixture-embedded");
      discoverModules(true);
      // Inject a toy 4d embedder matching the fixture descriptor; query [1,0,0,0]
      // is closest to s18's vector [0.98,...], so s18 must rank first.
      setQueryEmbedderForTest(async () => Float32Array.from([1, 0, 0, 0]), {
        model_id: "fixture-toy-4d",
        dim: 4,
      });
      const r = await semanticSearchLocal({ query: "misleading conduct" });
      expect(r.found).toBe(true);
      expect(r.hits.length).toBeGreaterThan(0);
      expect(r.hits[0]!.provision_ref).toBe("s 18");
      expect(r.hits[0]!.score).toBeGreaterThan(0);
      // Scores are sorted descending.
      for (let i = 1; i < r.hits.length; i++) {
        expect(r.hits[i - 1]!.score).toBeGreaterThanOrEqual(r.hits[i]!.score);
      }
      expect(r.hits[0]!.metadata.source).toBe("local_module");
    },
  );

  it.skipIf(!duckdbAvailable || embedderPresent)(
    "semantic_search_local degrades visibly when no embedder is present",
    async () => {
      installFixture(root, "fixture-embedded");
      discoverModules(true);
      setQueryEmbedderForTest(null);
      const r = await semanticSearchLocal({ query: "misleading conduct" });
      expect(r.found).toBe(false);
      expect(r.notes.some((n) => n.includes("embedder"))).toBe(true);
    },
  );
});
