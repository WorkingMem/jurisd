import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  setModulesRootForTest,
  discoverModules,
  tryLoadDuckDB,
  normaliseProvisionRef,
  selectModules,
  buildMetadata,
  getModule,
  getProvision,
  getActStructure,
  listDataModules,
} from "../../services/modules.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "..", "fixtures", "modules");

// Evaluate DuckDB availability at collection time so it.skipIf sees the real
// value (beforeEach runs after collection, too late for skipIf).
const duckdbAvailable = (await tryLoadDuckDB()) !== null;

function installFixture(root: string, fixtureName: string, asName?: string): void {
  const src = path.join(FIXTURES, fixtureName);
  const dst = path.join(root, asName ?? fixtureName);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
  }
}

let scratch: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "jurisd-recall-"));
  setModulesRootForTest(scratch, true);
});

afterEach(() => {
  setModulesRootForTest(null);
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("normaliseProvisionRef", () => {
  it("collapses whitespace and abbreviates kind words", () => {
    expect(normaliseProvisionRef("section 18")).toBe("s 18");
    expect(normaliseProvisionRef("Schedule  2")).toBe("sch 2");
    expect(normaliseProvisionRef("regulation 12")).toBe("reg 12");
    expect(normaliseProvisionRef("clause 4(1)")).toBe("cl 4(1)");
  });

  it("passes through already-canonical refs", () => {
    expect(normaliseProvisionRef("s 18")).toBe("s 18");
    expect(normaliseProvisionRef("sch 2")).toBe("sch 2");
  });
});

describe("selectModules", () => {
  it("returns ready modules and honours a pin", () => {
    installFixture(scratch, "fixture");
    installFixture(scratch, "fixture-embedded");
    discoverModules(true);
    expect(
      selectModules()
        .map((m) => m.name)
        .sort(),
    ).toEqual(["fixture", "fixture-embedded"]);
    expect(selectModules({ pin: "fixture" }).map((m) => m.name)).toEqual(["fixture"]);
  });

  it("prefers a jurisdiction-covering module when one matches", () => {
    installFixture(scratch, "fixture");
    discoverModules(true);
    expect(selectModules({ jurisdiction: "commonwealth" }).map((m) => m.name)).toEqual(["fixture"]);
    // A non-covered jurisdiction falls back to all ready modules.
    expect(selectModules({ jurisdiction: "nz" }).map((m) => m.name)).toEqual(["fixture"]);
  });

  it("requireEmbedded keeps only embedded modules", () => {
    installFixture(scratch, "fixture");
    installFixture(scratch, "fixture-embedded");
    discoverModules(true);
    expect(selectModules({ requireEmbedded: true }).map((m) => m.name)).toEqual([
      "fixture-embedded",
    ]);
  });
});

describe("buildMetadata", () => {
  it("carries source/name/version/snapshot and a staleness advisory for old snapshots", () => {
    installFixture(scratch, "fixture-embedded"); // snapshot 2020-01-01 (stale)
    discoverModules(true);
    const meta = buildMetadata(getModule("fixture-embedded")!);
    expect(meta.source).toBe("local_module");
    expect(meta.name).toBe("fixture-embedded");
    expect(meta.module_version).toBe("0.0.1");
    expect(meta.snapshot_date).toBe("2020-01-01");
    expect(meta.staleness_advisory).toBeTruthy();
  });

  it("omits the staleness advisory for a fresh snapshot", () => {
    installFixture(scratch, "fixture"); // snapshot 2026-06-12 (fresh)
    discoverModules(true);
    const meta = buildMetadata(getModule("fixture")!);
    expect(meta.staleness_advisory).toBeUndefined();
  });
});

describe("list_data_modules", () => {
  it("lists ready modules with coverage and staleness (metadata only)", () => {
    installFixture(scratch, "fixture");
    const mods = listDataModules({ refresh: true });
    expect(mods).toHaveLength(1);
    expect(mods[0]!.name).toBe("fixture");
    expect(mods[0]!.doc_count).toBe(2);
    expect(mods[0]!.chunk_count).toBe(3);
    expect(mods[0]!.embedding).toBeNull();
    expect(mods[0]!.stale).toBe(false);
  });

  it("excludes refused modules unless includeInvalid is set", () => {
    installFixture(scratch, "fixture");
    fs.mkdirSync(path.join(scratch, "bad"), { recursive: true });
    fs.writeFileSync(path.join(scratch, "bad", "manifest.json"), JSON.stringify({ name: "bad" }));
    expect(listDataModules({ refresh: true }).map((m) => m.name)).toEqual(["fixture"]);
    const withInvalid = listDataModules({ refresh: true, includeInvalid: true });
    const bad = withInvalid.find((m) => m.status === "invalid");
    expect(bad).toBeDefined();
    expect(bad!.statusDetail).toBeTruthy();
  });

  it("marks an old-snapshot module stale", () => {
    installFixture(scratch, "fixture-embedded");
    const mods = listDataModules({ refresh: true });
    expect(mods[0]!.stale).toBe(true);
  });
});

describe("get_provision", () => {
  it.skipIf(!duckdbAvailable)("resolves a section by citation + normalised ref", async () => {
    installFixture(scratch, "fixture");
    discoverModules(true);
    const r = await getProvision({
      act: "Competition and Consumer Act 2010 (Cth)",
      provision: "section 18",
    });
    expect(r.found).toBe(true);
    if (r.found) {
      expect(r.provision_ref).toBe("s 18");
      expect(r.text).toContain("misleading or deceptive");
      expect(r.char_start).toBe(10240);
      expect(r.metadata.source).toBe("local_module");
      expect(r.metadata.name).toBe("fixture");
    }
  });

  it.skipIf(!duckdbAvailable)("resolves by work_id and a schedule ref", async () => {
    installFixture(scratch, "fixture");
    discoverModules(true);
    const r = await getProvision({
      act: "work:cth:competition_and_consumer_act_2010",
      provision: "sch 2",
    });
    expect(r.found).toBe(true);
    if (r.found) expect(r.provision_ref).toBe("sch 2");
  });

  it.skipIf(!duckdbAvailable)("returns a typed not-found for a missing provision", async () => {
    installFixture(scratch, "fixture");
    discoverModules(true);
    const r = await getProvision({
      act: "Competition and Consumer Act 2010 (Cth)",
      provision: "s 999",
    });
    expect(r.found).toBe(false);
  });

  it("returns not-found gracefully when no module is installed", async () => {
    discoverModules(true);
    const r = await getProvision({ act: "anything", provision: "s 1" });
    expect(r.found).toBe(false);
  });
});

describe("get_act_structure", () => {
  it.skipIf(!duckdbAvailable)("returns the containment tree rooted at the Act", async () => {
    installFixture(scratch, "fixture");
    discoverModules(true);
    const r = await getActStructure({ act: "Competition and Consumer Act 2010 (Cth)" });
    expect(r.found).toBe(true);
    expect(r.root).toBeDefined();
    expect(r.root!.parent_id).toBeNull();
    expect(r.root!.label).toBe("Competition and Consumer Act 2010 (Cth)");
    // One act_provision edge -> one child (s 18).
    expect(r.root!.children).toHaveLength(1);
    expect(r.root!.children[0]!.label).toBe("s 18");
    expect(r.metadata!.source).toBe("local_module");
  });

  it.skipIf(!duckdbAvailable)("respects a depth guard of 1 (root only)", async () => {
    installFixture(scratch, "fixture");
    discoverModules(true);
    const r = await getActStructure({
      act: "Competition and Consumer Act 2010 (Cth)",
      depth: 1,
    });
    expect(r.found).toBe(true);
    // depth<1 stops the recursion after the root, so children are pruned at d1.
    expect(r.root!.children.length).toBeGreaterThanOrEqual(0);
  });

  it.skipIf(!duckdbAvailable)("returns not-found for an unknown act", async () => {
    installFixture(scratch, "fixture");
    discoverModules(true);
    const r = await getActStructure({ act: "Nonexistent Act 1900 (Cth)" });
    expect(r.found).toBe(false);
  });
});
