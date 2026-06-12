import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { fetchModule, verifyModule, type FetchIO } from "../../services/fetch-module.js";

const sha = (buf: Buffer): string => crypto.createHash("sha256").update(buf).digest("hex");

/** Build a tiny in-memory module: a manifest + one fake parquet asset. */
function buildFakeModule(name: string, over: Record<string, unknown> = {}) {
  const docBytes = Buffer.from(`fake-parquet-for-${name}`);
  const manifest = {
    name,
    module_version: "1.0.0",
    schema_version: 1,
    yanked: false,
    base_uri: "https://assets.test/m/",
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
    files: [{ path: "documents.parquet", sha256: sha(docBytes), rows: 1 }],
    licence: {
      spdx: "CC-BY-4.0",
      per_source: [],
      attribution: ["Contains CC BY 4.0 material."],
    },
    ...over,
  };
  return { manifest, docBytes };
}

/** A mock IO serving a fixed manifest + asset bytes; records what was fetched. */
function mockIO(
  manifest: unknown,
  assets: Record<string, Buffer>,
): FetchIO & { fetched: string[] } {
  const fetched: string[] = [];
  return {
    fetched,
    async fetchJson(url: string): Promise<unknown> {
      fetched.push(url);
      if (url.endsWith("manifest.json")) return manifest;
      throw new Error(`unexpected json url ${url}`);
    },
    async fetchBytes(url: string): Promise<Buffer> {
      fetched.push(url);
      const key = url.split("/").pop()!;
      const buf = assets[key];
      if (!buf) throw new Error(`404 ${url}`);
      return buf;
    },
  };
}

let modulesDir: string;

beforeEach(() => {
  modulesDir = fs.mkdtempSync(path.join(os.tmpdir(), "jurisd-fetch-"));
});

afterEach(() => {
  fs.rmSync(modulesDir, { recursive: true, force: true });
});

describe("fetchModule", () => {
  it("downloads, sha256-verifies, and atomically installs a module", async () => {
    const { manifest, docBytes } = buildFakeModule("legislation-cth");
    const io = mockIO(manifest, { "documents.parquet": docBytes });
    const r = await fetchModule("legislation-cth", {
      manifestUrl: "https://gh.test/releases/download/legislation-cth/manifest.json",
      modulesDir,
      io,
    });
    expect(r.ok).toBe(true);
    expect(r.installedPath).toBe(path.join(modulesDir, "legislation-cth"));
    expect(fs.existsSync(path.join(modulesDir, "legislation-cth", "documents.parquet"))).toBe(true);
    expect(fs.existsSync(path.join(modulesDir, "legislation-cth", "manifest.json"))).toBe(true);
    expect(r.attribution).toEqual(["Contains CC BY 4.0 material."]);
  });

  it("rejects a tampered file (sha256 mismatch) and installs nothing", async () => {
    const { manifest } = buildFakeModule("legislation-cth");
    const tampered = Buffer.from("TAMPERED bytes not matching the manifest hash");
    const io = mockIO(manifest, { "documents.parquet": tampered });
    const r = await fetchModule("legislation-cth", {
      manifestUrl: "https://gh.test/m/manifest.json",
      modulesDir,
      io,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("sha256 mismatch");
    // Atomic install: nothing left behind.
    expect(fs.existsSync(path.join(modulesDir, "legislation-cth"))).toBe(false);
  });

  it("refuses an unimplemented schema_version BEFORE downloading any parquet", async () => {
    const { manifest, docBytes } = buildFakeModule("future-mod", { schema_version: 2 });
    const io = mockIO(manifest, { "documents.parquet": docBytes });
    const r = await fetchModule("future-mod", {
      manifestUrl: "https://gh.test/m/manifest.json",
      modulesDir,
      io,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("schema_version");
    // Only the manifest was fetched; no parquet download attempted.
    expect(io.fetched.some((u) => u.includes(".parquet"))).toBe(false);
  });

  it("refuses a yanked module", async () => {
    const { manifest, docBytes } = buildFakeModule("yanked-mod", { yanked: true });
    const io = mockIO(manifest, { "documents.parquet": docBytes });
    const r = await fetchModule("yanked-mod", {
      manifestUrl: "https://gh.test/m/manifest.json",
      modulesDir,
      io,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("yanked");
    expect(io.fetched.some((u) => u.includes(".parquet"))).toBe(false);
  });

  it("refuses an invalid manifest before any download", async () => {
    const io = mockIO({ name: "bad" }, {});
    const r = await fetchModule("bad", {
      manifestUrl: "https://gh.test/m/manifest.json",
      modulesDir,
      io,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("schema validation");
  });

  it("refuses when the manifest name does not match the requested name", async () => {
    const { manifest, docBytes } = buildFakeModule("real-name");
    const io = mockIO(manifest, { "documents.parquet": docBytes });
    const r = await fetchModule("requested-name", {
      manifestUrl: "https://gh.test/m/manifest.json",
      modulesDir,
      io,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("does not match");
  });

  it("rejects an unsafe module name without touching the network", async () => {
    const io = mockIO({}, {});
    const r = await fetchModule("evil;drop", { modulesDir, io });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("safe identifier");
    expect(io.fetched).toHaveLength(0);
  });

  it("replaces a prior installed version atomically", async () => {
    const first = buildFakeModule("legislation-cth");
    await fetchModule("legislation-cth", {
      manifestUrl: "https://gh.test/m/manifest.json",
      modulesDir,
      io: mockIO(first.manifest, { "documents.parquet": first.docBytes }),
    });
    // A new version with different bytes.
    const newBytes = Buffer.from("v2 parquet bytes");
    const second = buildFakeModule("legislation-cth", {
      module_version: "2.0.0",
      files: [{ path: "documents.parquet", sha256: sha(newBytes), rows: 1 }],
    });
    const r = await fetchModule("legislation-cth", {
      manifestUrl: "https://gh.test/m/manifest.json",
      modulesDir,
      io: mockIO(second.manifest, { "documents.parquet": newBytes }),
    });
    expect(r.ok).toBe(true);
    const installed = fs.readFileSync(
      path.join(modulesDir, "legislation-cth", "documents.parquet"),
    );
    expect(installed.toString()).toBe("v2 parquet bytes");
  });
});

describe("verifyModule", () => {
  it("verifies an installed module's files against the manifest", async () => {
    const { manifest, docBytes } = buildFakeModule("legislation-cth");
    await fetchModule("legislation-cth", {
      manifestUrl: "https://gh.test/m/manifest.json",
      modulesDir,
      io: mockIO(manifest, { "documents.parquet": docBytes }),
    });
    const r = verifyModule("legislation-cth", { modulesDir });
    expect(r.ok).toBe(true);
  });

  it("detects a post-install tamper", async () => {
    const { manifest, docBytes } = buildFakeModule("legislation-cth");
    await fetchModule("legislation-cth", {
      manifestUrl: "https://gh.test/m/manifest.json",
      modulesDir,
      io: mockIO(manifest, { "documents.parquet": docBytes }),
    });
    // Tamper with the installed parquet.
    fs.writeFileSync(
      path.join(modulesDir, "legislation-cth", "documents.parquet"),
      "tampered after install",
    );
    const r = verifyModule("legislation-cth", { modulesDir });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("sha256 mismatch");
  });

  it("reports a not-installed module", () => {
    const r = verifyModule("absent", { modulesDir });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("not installed");
  });
});
