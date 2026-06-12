import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchModule, verifyModule, type FetchIO } from "../../services/fetch-module.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "../fixtures/modules/fixture");

const MANIFEST = JSON.parse(fs.readFileSync(path.join(FIXTURE, "manifest.json"), "utf-8")) as {
  name: string;
  base_uri: string;
  files: { path: string; sha256: string }[];
};

/**
 * A FetchIO backed by the vendored fixture files (correct sha256). `tamper`
 * names one file whose bytes are corrupted so its hash will not match.
 */
function fixtureIO(tamper?: string): FetchIO {
  return {
    async fetchJson(): Promise<unknown> {
      return JSON.parse(fs.readFileSync(path.join(FIXTURE, "manifest.json"), "utf-8"));
    },
    async fetchBytes(url: string): Promise<Buffer> {
      const rel = url.split("/").pop()!;
      const bytes = fs.readFileSync(path.join(FIXTURE, rel));
      if (rel === tamper) return Buffer.concat([bytes, Buffer.from("TAMPER")]);
      return bytes;
    },
  };
}

let modulesDir: string;
beforeEach(() => {
  modulesDir = fs.mkdtempSync(path.join(os.tmpdir(), "wse-fetch-"));
});
afterEach(() => {
  fs.rmSync(modulesDir, { recursive: true, force: true });
});

describe("WS-E fetch-module — sha256 verification (design §5)", () => {
  it("installs a clean module when every file's sha256 matches", async () => {
    const r = await fetchModule(MANIFEST.name, { modulesDir, io: fixtureIO() });
    expect(r.ok).toBe(true);
    expect(r.installedPath).toBe(path.join(modulesDir, MANIFEST.name));
    expect(fs.existsSync(path.join(modulesDir, MANIFEST.name, "manifest.json"))).toBe(true);
    expect(r.attribution?.length).toBeGreaterThan(0);
  });

  it("rejects a tampered file by sha256 and installs nothing", async () => {
    const r = await fetchModule(MANIFEST.name, {
      modulesDir,
      io: fixtureIO("chunks.parquet"),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("sha256 mismatch");
    expect(r.error).toContain("chunks.parquet");
    // No half-written module is left behind.
    expect(fs.existsSync(path.join(modulesDir, MANIFEST.name))).toBe(false);
    // And no staging/temp residue in the modules dir.
    expect(fs.readdirSync(modulesDir)).toHaveLength(0);
  });

  it("leaves a prior install intact when a re-fetch fails verification", async () => {
    const first = await fetchModule(MANIFEST.name, { modulesDir, io: fixtureIO() });
    expect(first.ok).toBe(true);
    const second = await fetchModule(MANIFEST.name, {
      modulesDir,
      io: fixtureIO("documents.parquet"),
    });
    expect(second.ok).toBe(false);
    // The good prior install is still present and still verifies.
    expect(verifyModule(MANIFEST.name, { modulesDir }).ok).toBe(true);
  });

  it("refuses an unsafe module name before any network call", async () => {
    const r = await fetchModule("evil; DROP TABLE x", { modulesDir, io: fixtureIO() });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("safe identifier");
  });

  it("verifyModule detects post-install tampering on disk", async () => {
    const r = await fetchModule(MANIFEST.name, { modulesDir, io: fixtureIO() });
    expect(r.ok).toBe(true);
    // Corrupt an installed file after the fact.
    fs.appendFileSync(path.join(modulesDir, MANIFEST.name, "edges.parquet"), "X");
    const v = verifyModule(MANIFEST.name, { modulesDir });
    expect(v.ok).toBe(false);
    expect(v.error).toContain("edges.parquet");
  });
});
