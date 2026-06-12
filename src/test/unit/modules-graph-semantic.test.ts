import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  setModulesRootForTest,
  discoverModules,
  tryLoadDuckDB,
  findCiting,
  semanticSearchLocal,
} from "../../services/modules.js";
import {
  setQueryEmbedderForTest,
  resetEmbedder,
  isEmbedderAvailable,
} from "../../services/embedder.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "..", "fixtures", "modules");

const duckdbAvailable = (await tryLoadDuckDB()) !== null;

function installFixture(root: string, fixtureName: string, asName?: string): void {
  const src = path.join(FIXTURES, fixtureName);
  const dst = path.join(root, asName ?? fixtureName);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
  }
}

/** A deterministic 4-dim toy embedder matching the embedded fixture descriptor. */
function installToyEmbedder(vec: number[]): void {
  setQueryEmbedderForTest(async () => Float32Array.from(vec), {
    model_id: "fixture-toy-4d",
    dim: 4,
  });
}

let scratch: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "jurisd-gs-"));
  setModulesRootForTest(scratch, true);
  resetEmbedder();
});

afterEach(() => {
  setModulesRootForTest(null);
  resetEmbedder();
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("find_citing", () => {
  it.skipIf(!duckdbAvailable)("finds the decision that cites the Act", async () => {
    installFixture(scratch, "fixture");
    discoverModules(true);
    const r = await findCiting({ target: "Competition and Consumer Act 2010 (Cth)" });
    expect(r.found).toBe(true);
    expect(r.hits.length).toBeGreaterThanOrEqual(1);
    const mabo = r.hits.find((h) => h.citation.includes("Mabo"));
    expect(mabo).toBeDefined();
    expect(mabo!.kind).toBe("cites");
    expect(mabo!.pinpoint).toBe("s 18");
    expect(mabo!.metadata.source).toBe("local_module");
  });

  it.skipIf(!duckdbAvailable)("filters by edge kind", async () => {
    installFixture(scratch, "fixture");
    discoverModules(true);
    // Only 'considers' edges exist in the fixture for nothing -> no hits.
    const r = await findCiting({
      target: "Competition and Consumer Act 2010 (Cth)",
      kinds: ["considers"],
    });
    expect(r.found).toBe(false);
  });

  it.skipIf(!duckdbAvailable)("resolves the target by work_id", async () => {
    installFixture(scratch, "fixture");
    discoverModules(true);
    const r = await findCiting({ target: "work:cth:competition_and_consumer_act_2010" });
    expect(r.found).toBe(true);
  });

  it("returns not-found gracefully when no module is installed", async () => {
    discoverModules(true);
    const r = await findCiting({ target: "anything" });
    expect(r.found).toBe(false);
    expect(r.hits).toEqual([]);
  });
});

describe("semantic_search_local", () => {
  it.skipIf(!duckdbAvailable)("ranks chunks by cosine over the embedded fixture", async () => {
    installFixture(scratch, "fixture-embedded");
    discoverModules(true);
    installToyEmbedder([1, 0, 0, 0]); // closest to s18 vector
    const r = await semanticSearchLocal({ query: "misleading conduct" });
    expect(r.found).toBe(true);
    expect(r.hits[0]!.provision_ref).toBe("s 18");
    expect(r.hits[0]!.score).toBeGreaterThan(r.hits[1]!.score);
    expect(r.hits[0]!.metadata.source).toBe("local_module");
  });

  it.skipIf(!duckdbAvailable)("applies a segment_type facet pre-filter", async () => {
    installFixture(scratch, "fixture-embedded");
    discoverModules(true);
    installToyEmbedder([0, 1, 0, 0]);
    const r = await semanticSearchLocal({
      query: "consumer law",
      filter: { segment_type: "schedule" },
    });
    expect(r.found).toBe(true);
    expect(r.hits.every((h) => h.segment_type === "schedule")).toBe(true);
  });

  it.skipIf(!duckdbAvailable)(
    "skips a module whose embedding space does not match (hard gate, visible note)",
    async () => {
      installFixture(scratch, "fixture-embedded");
      discoverModules(true);
      // Advertise a mismatched embedder (bge/384) for a 4-dim module.
      setQueryEmbedderForTest(async () => Float32Array.from([1, 0, 0, 0]), {
        model_id: "Xenova/bge-small-en-v1.5",
        dim: 384,
      });
      const r = await semanticSearchLocal({ query: "anything" });
      expect(r.found).toBe(false);
      expect(r.notes.join(" ")).toContain("does not match the active embedder");
    },
  );

  it("degrades visibly when the local embedder is absent", async () => {
    installFixture(scratch, "fixture-embedded");
    discoverModules(true);
    // No embedder injected; with @huggingface/transformers absent in CI,
    // getQueryEmbedder returns null and the tool reports a typed note.
    const embedderPresent = await isEmbedderAvailable();
    const r = await semanticSearchLocal({ query: "anything" });
    if (!embedderPresent) {
      expect(r.found).toBe(false);
      expect(r.notes.join(" ")).toContain("local embedder unavailable");
    } else {
      // If the optional dep IS installed locally, the real bge embedder runs
      // but the 4-dim fixture mismatches its 384-dim space -> still no hits.
      expect(r.found).toBe(false);
    }
  });

  it("reports no embedded module when only graph fixtures are installed", async () => {
    installFixture(scratch, "fixture"); // embedding: null
    discoverModules(true);
    installToyEmbedder([1, 0, 0, 0]);
    const r = await semanticSearchLocal({ query: "anything" });
    expect(r.found).toBe(false);
    expect(r.notes.join(" ")).toContain("no embedded ready module");
  });
});
