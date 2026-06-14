import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  fetchModule,
  verifyModule,
  assertModuleUrl,
  type FetchIO,
} from "../../services/fetch-module.js";
import { isSafeModuleFilePath, validateManifest } from "../../data/manifest.js";

const sha = (buf: Buffer): string => crypto.createHash("sha256").update(buf).digest("hex");

function baseManifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  const docBytes = Buffer.from("fake-parquet");
  return {
    name: "legislation-cth",
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
    licence: { spdx: "CC-BY-4.0", per_source: [], attribution: [] },
    ...over,
  };
}

function mockIO(
  manifest: unknown,
  assets: Record<string, Buffer>,
): FetchIO & { fetched: string[] } {
  const fetched: string[] = [];
  return {
    fetched,
    async fetchJson(url: string): Promise<unknown> {
      fetched.push(url);
      return manifest;
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
  modulesDir = fs.mkdtempSync(path.join(os.tmpdir(), "jurisd-sec-"));
});
afterEach(() => {
  fs.rmSync(modulesDir, { recursive: true, force: true });
});

describe("isSafeModuleFilePath", () => {
  it("accepts safe relative paths", () => {
    for (const p of ["documents.parquet", "a/b/c.parquet", "x_y-z.bin", "Sub/File.txt"]) {
      expect(isSafeModuleFilePath(p)).toBe(true);
    }
  });

  it("rejects traversal, absolute, and exotic paths", () => {
    for (const p of [
      "../escape",
      "../../etc/passwd",
      "/etc/passwd",
      "a/../../b",
      "./hidden",
      ".hidden",
      "foo\\bar",
      "with\0nul",
      "",
      "/",
      123 as unknown,
    ]) {
      expect(isSafeModuleFilePath(p as unknown)).toBe(false);
    }
  });
});

describe("validateManifest security constraints", () => {
  it("rejects a path-traversal files[].path (zip-slip)", () => {
    const r = validateManifest(
      baseManifest({ files: [{ path: "../../evil.sh", sha256: "a".repeat(64), rows: 1 }] }),
    );
    expect(r.valid).toBe(false);
    expect(r.error).toContain("safe relative path");
  });

  it("rejects an absolute files[].path", () => {
    const r = validateManifest(
      baseManifest({ files: [{ path: "/home/op/.bashrc", sha256: "a".repeat(64), rows: 1 }] }),
    );
    expect(r.valid).toBe(false);
    expect(r.error).toContain("safe relative path");
  });

  it("rejects a __proto__ key (prototype pollution)", () => {
    // JSON.parse materialises __proto__ as an own enumerable property.
    const hostile = JSON.parse('{"__proto__":{"polluted":true},"name":"x"}');
    const r = validateManifest({ ...baseManifest(), ...hostile });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("forbidden key");
  });

  it("rejects a non-https base_uri", () => {
    const r = validateManifest(baseManifest({ base_uri: "http://assets.test/m/" }));
    expect(r.valid).toBe(false);
    expect(r.error).toContain("https");
  });

  it("rejects a file: / javascript: base_uri", () => {
    for (const base_uri of ["file:///etc/", "javascript:alert(1)"]) {
      const r = validateManifest(baseManifest({ base_uri }));
      expect(r.valid).toBe(false);
    }
  });

  it("accepts a well-formed manifest", () => {
    expect(validateManifest(baseManifest()).valid).toBe(true);
  });
});

describe("fetchModule path-traversal defence (end to end)", () => {
  it("refuses to install a module whose manifest contains a traversal path, writing nothing outside the temp dir", async () => {
    const evil = baseManifest({
      files: [{ path: "../../../../tmp/jurisd-escape-poc", sha256: "a".repeat(64), rows: 1 }],
    });
    const io = mockIO(evil, {});
    const r = await fetchModule("legislation-cth", {
      manifestUrl: "https://gh.test/m/manifest.json",
      modulesDir,
      io,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/safe relative path|schema validation/);
    expect(fs.existsSync("/tmp/jurisd-escape-poc")).toBe(false);
    // Rejected at validation: no parquet fetch attempted.
    expect(io.fetched.some((u) => u.includes("escape"))).toBe(false);
  });
});

describe("verifyModule path-traversal defence", () => {
  it("rejects an on-disk manifest with a traversal path instead of reading outside the module dir", () => {
    const dir = path.join(modulesDir, "legislation-cth");
    fs.mkdirSync(dir, { recursive: true });
    const manifest = baseManifest({
      files: [{ path: "../../../../etc/hostname", sha256: "a".repeat(64), rows: 1 }],
    });
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
    const r = verifyModule("legislation-cth", { modulesDir });
    expect(r.ok).toBe(false);
    // Either schema validation or the verify-site guard rejects it.
    expect(r.error).toMatch(/safe relative path|schema validation/);
  });
});

describe("assertModuleUrl (SSRF guard)", () => {
  it("accepts Hugging Face hosts", () => {
    for (const u of [
      "https://huggingface.co/datasets/workingmem/legislation-cth/resolve/main/manifest.json",
      "https://cdn-lfs.huggingface.co/datasets/x/file.parquet",
      "https://cas-bridge.xethub.hf.co/x/file",
    ]) {
      expect(() => assertModuleUrl(u)).not.toThrow();
    }
  });

  it("rejects internal/metadata addresses and non-https", () => {
    for (const u of [
      "http://huggingface.co/x", // not https
      "https://169.254.169.254/latest/meta-data/", // metadata
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://evil.example.com/x",
      "https://huggingface.co.evil.com/x", // suffix-confusion
      "file:///etc/passwd",
    ]) {
      expect(() => assertModuleUrl(u)).toThrow();
    }
  });
});
