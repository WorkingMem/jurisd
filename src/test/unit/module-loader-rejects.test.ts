import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { setModulesRootForTest, discoverModules, getModule } from "../../services/modules.js";
import { validateManifest } from "../../data/manifest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VALID_MANIFEST = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../fixtures/modules/fixture/manifest.json"), "utf-8"),
) as Record<string, unknown>;

let root: string;

/** Write a module dir containing only a manifest (loader reads metadata first). */
function writeModule(name: string, manifest: unknown): void {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    typeof manifest === "string" ? manifest : JSON.stringify(manifest),
  );
}

function cloneValid(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(VALID_MANIFEST)) as Record<string, unknown>;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "wse-loader-"));
  setModulesRootForTest(root, true);
});
afterEach(() => {
  setModulesRootForTest(null);
  fs.rmSync(root, { recursive: true, force: true });
});

describe("loader — rejects invalid/tampered manifests", () => {
  it("refuses an unimplemented schema_version (status unsupported_schema_version)", () => {
    const m = cloneValid();
    m.name = "future-mod";
    m.schema_version = 99;
    writeModule("future-mod", m);
    discoverModules(true);
    // Structurally valid → keyed by manifest name; classified by schema version.
    const entry = getModule("future-mod");
    expect(entry?.status).toBe("unsupported_schema_version");
    expect(entry?.statusDetail).toContain("99");
  });

  it("refuses a yanked module (status yanked)", () => {
    const m = cloneValid();
    m.name = "yanked-mod";
    m.yanked = true;
    writeModule("yanked-mod", m);
    discoverModules(true);
    expect(getModule("yanked-mod")?.status).toBe("yanked");
  });

  it("refuses an SQL-unsafe / path-unsafe module name (status invalid)", () => {
    const m = cloneValid();
    // An identifier that would break the M__view naming and invite injection.
    m.name = "evil; DROP TABLE x";
    writeModule("evilname", m);
    discoverModules(true);
    // Structurally valid (name is a non-empty string) so it is keyed by the
    // manifest name, but classifyManifest refuses it as not a safe identifier —
    // closing the SQL-identifier-injection path before any view is created.
    const entry = getModule("evil; DROP TABLE x");
    expect(entry?.status).toBe("invalid");
    expect(entry?.statusDetail).toContain("safe identifier");
  });

  it("refuses a structurally invalid manifest (missing required fields)", () => {
    writeModule("broken", { name: "broken" });
    discoverModules(true);
    expect(getModule("broken")?.status).toBe("invalid");
  });

  it("refuses a manifest with a tampered (non-hex) sha256", () => {
    const m = cloneValid();
    m.name = "tampered-sha";
    const files = m.files as { sha256: string }[];
    files[0]!.sha256 = "not-a-real-hash";
    writeModule("tampered-sha", m);
    discoverModules(true);
    const entry = getModule("tampered-sha");
    expect(entry?.status).toBe("invalid");
  });

  it("skips a module whose manifest.json is unparseable JSON (never throws)", () => {
    writeModule("badjson", "{ this is not json ");
    expect(() => discoverModules(true)).not.toThrow();
    expect(getModule("badjson")).toBeUndefined();
  });

  it("skips a module with no manifest.json at all", () => {
    fs.mkdirSync(path.join(root, "empty-mod"), { recursive: true });
    expect(() => discoverModules(true)).not.toThrow();
    expect(getModule("empty-mod")).toBeUndefined();
  });

  it("validateManifest rejects a non-object and reports a typed error", () => {
    const r = validateManifest(null);
    expect(r.valid).toBe(false);
    expect(r.error).toBeTruthy();
  });
});
