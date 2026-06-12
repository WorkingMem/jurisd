import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import {
  discoverModules,
  listModules,
  readyModules,
  getModule,
  setModulesRootForTest,
  viewNames,
  tryLoadDuckDB,
  attachModule,
  runModuleQuery,
} from "../../services/modules.js";

const FIXTURES = path.join(__dirname, "..", "fixtures", "modules");

/** Copy a vendored fixture module into a scratch modules dir under `root`. */
function installFixture(root: string, fixtureName: string, asName?: string): void {
  const src = path.join(FIXTURES, fixtureName);
  const dst = path.join(root, asName ?? fixtureName);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
  }
}

/** Write an arbitrary manifest.json into a fresh module dir (no parquet). */
function writeBareModule(root: string, dirName: string, manifest: unknown): void {
  const dst = path.join(root, dirName);
  fs.mkdirSync(dst, { recursive: true });
  fs.writeFileSync(path.join(dst, "manifest.json"), JSON.stringify(manifest, null, 2));
}

function validBaseManifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "fixture",
    module_version: "0.0.1",
    schema_version: 1,
    yanked: false,
    base_uri: "https://example.test/m/",
    snapshot: {
      corpus_sha: "0".repeat(40),
      date: "2026-01-01",
      recipe_repo: "r/d",
      recipe_git_sha: "abcdef0",
      args: {},
    },
    coverage: {
      jurisdictions: ["commonwealth"],
      types: ["primary_legislation"],
      doc_count: 1,
      chunk_count: 1,
    },
    embedding: null,
    files: [{ path: "documents.parquet", sha256: "a".repeat(64), rows: 1 }],
    licence: { spdx: "CC-BY-4.0", per_source: [], attribution: [] },
    ...over,
  };
}

let scratch: string;
let duckdbAvailable = false;

beforeEach(async () => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "jurisd-mods-"));
  setModulesRootForTest(scratch, true);
  duckdbAvailable = (await tryLoadDuckDB()) !== null;
});

afterEach(() => {
  setModulesRootForTest(null);
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("module discovery + validation", () => {
  it("returns an empty registry when the modules dir does not exist", () => {
    fs.rmSync(scratch, { recursive: true, force: true });
    expect(listModules(true)).toHaveLength(0);
  });

  it("discovers a valid fixture module as ready", () => {
    installFixture(scratch, "fixture");
    const mods = listModules(true);
    expect(mods).toHaveLength(1);
    expect(mods[0]!.name).toBe("fixture");
    expect(mods[0]!.status).toBe("ready");
    expect(mods[0]!.manifest!.coverage.doc_count).toBe(2);
  });

  it("holds metadata only — no attach happens at discovery", () => {
    installFixture(scratch, "fixture");
    const m = getModule("fixture");
    expect(m).toBeDefined();
    expect(m!.attached).toBe(false);
  });

  it("refuses an unimplemented schema_version", () => {
    writeBareModule(scratch, "future", validBaseManifest({ name: "future", schema_version: 2 }));
    const m = listModules(true).find((x) => x.name === "future");
    expect(m!.status).toBe("unsupported_schema_version");
    expect(m!.statusDetail).toContain("schema_version");
  });

  it("refuses a yanked module", () => {
    writeBareModule(scratch, "yanked", validBaseManifest({ name: "yanked", yanked: true }));
    const m = listModules(true).find((x) => x.name === "yanked");
    expect(m!.status).toBe("yanked");
  });

  it("refuses an invalid manifest (schema validation failure)", () => {
    writeBareModule(scratch, "bad", { name: "bad" }); // missing required fields
    const m = listModules(true).find((x) => x.name === "bad");
    expect(m!.status).toBe("invalid");
    expect(m!.statusDetail).toBeTruthy();
  });

  it("refuses a module whose manifest name is not a safe SQL identifier", () => {
    writeBareModule(scratch, "evil", validBaseManifest({ name: "drop;table" }));
    const m = listModules(true).find((x) => x.status === "invalid");
    expect(m).toBeDefined();
    expect(m!.statusDetail).toContain("safe identifier");
  });

  it("skips a dir with no manifest.json without throwing", () => {
    fs.mkdirSync(path.join(scratch, "empty"), { recursive: true });
    expect(() => listModules(true)).not.toThrow();
    expect(getModule("empty")).toBeUndefined();
  });

  it("skips a dir with unparseable manifest.json", () => {
    const dst = path.join(scratch, "broken");
    fs.mkdirSync(dst, { recursive: true });
    fs.writeFileSync(path.join(dst, "manifest.json"), "{ not json");
    expect(() => listModules(true)).not.toThrow();
    expect(getModule("broken")).toBeUndefined();
  });

  it("manifest identity wins over directory name", () => {
    installFixture(scratch, "fixture", "renamed-dir");
    const mods = listModules(true);
    expect(mods).toHaveLength(1);
    expect(mods[0]!.name).toBe("fixture"); // not "renamed-dir"
  });

  it("readyModules filters out refused modules", () => {
    installFixture(scratch, "fixture");
    writeBareModule(scratch, "yanked", validBaseManifest({ name: "yanked", yanked: true }));
    expect(readyModules(true).map((m) => m.name)).toEqual(["fixture"]);
  });

  it("discovers a multi-module dir", () => {
    installFixture(scratch, "fixture");
    installFixture(scratch, "fixture-embedded");
    const names = listModules(true)
      .map((m) => m.name)
      .sort();
    expect(names).toEqual(["fixture", "fixture-embedded"]);
  });

  it("disabling the module layer yields an empty registry", () => {
    installFixture(scratch, "fixture");
    setModulesRootForTest(scratch, false);
    expect(listModules(true)).toHaveLength(0);
  });
});

describe("view names", () => {
  it("derives the four scoped view names from the module name", () => {
    expect(viewNames("legislation-cth")).toEqual({
      documents: "legislation-cth__documents",
      chunks: "legislation-cth__chunks",
      edges: "legislation-cth__edges",
      unmatched: "legislation-cth__unmatched",
    });
  });
});

describe("lazy DuckDB attach", () => {
  it.skipIf(!duckdbAvailable)("attaches a module and queries it via bound params", async () => {
    installFixture(scratch, "fixture");
    discoverModules(true);
    const entry = await attachModule("fixture");
    expect(entry).toBeDefined();
    expect(entry!.attached).toBe(true);

    const rows = await runModuleQuery(
      `SELECT count(*) AS n FROM "fixture__documents" WHERE jurisdiction = $1`,
      ["commonwealth"],
    );
    expect(Number(rows[0]!.n)).toBe(2);
  });

  it.skipIf(!duckdbAvailable)("attach is idempotent", async () => {
    installFixture(scratch, "fixture");
    discoverModules(true);
    await attachModule("fixture");
    const again = await attachModule("fixture");
    expect(again!.attached).toBe(true);
  });

  it("attachModule returns null for an unknown module", async () => {
    discoverModules(true);
    expect(await attachModule("nope")).toBeNull();
  });
});
