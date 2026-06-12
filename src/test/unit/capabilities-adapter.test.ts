import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  baselineAdapter,
  readIsaacusConfig,
  buildIsaacusAdapter,
  probeDomainAdapter,
  resetAdapterState,
  type LocalChunk,
} from "../../services/adapter.js";
import { probeCapabilities, resetCapabilitiesCache } from "../../services/capabilities.js";
import {
  setModulesRootForTest,
  discoverModules,
  tryLoadDuckDB,
  semanticSearchLocal,
} from "../../services/modules.js";
import { setQueryEmbedderForTest, resetEmbedder } from "../../services/embedder.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "..", "fixtures", "modules");
const duckdbAvailable = (await tryLoadDuckDB()) !== null;

function installFixture(root: string, fixtureName: string): void {
  const src = path.join(FIXTURES, fixtureName);
  const dst = path.join(root, fixtureName);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
  }
}

let scratch: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "jurisd-cap-"));
  setModulesRootForTest(scratch, true);
  resetEmbedder();
  resetAdapterState();
  resetCapabilitiesCache();
  vi.unstubAllEnvs();
});

afterEach(() => {
  setModulesRootForTest(null);
  resetEmbedder();
  resetAdapterState();
  resetCapabilitiesCache();
  vi.unstubAllEnvs();
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("readIsaacusConfig", () => {
  it("returns null with no key", () => {
    vi.stubEnv("ISAACUS_API_KEY", undefined);
    expect(readIsaacusConfig()).toBeNull();
  });

  it("reads the BYOK key and default base url", () => {
    vi.stubEnv("ISAACUS_API_KEY", "sk-test");
    const cfg = readIsaacusConfig();
    expect(cfg!.apiKey).toBe("sk-test");
    expect(cfg!.baseUrl).toContain("isaacus");
  });
});

describe("probeDomainAdapter", () => {
  it("returns the baseline adapter when no provider is configured", async () => {
    vi.stubEnv("ISAACUS_API_KEY", undefined);
    const probe = await probeDomainAdapter();
    expect(probe.adapter).toBe(baselineAdapter);
    expect(probe.adapter.label).toBe("baseline");
    expect(probe.configured).toBe(false);
    expect(probe.reachable).toBe(false);
  });

  it("degrades to baseline when configured but unreachable (no throw)", async () => {
    vi.stubEnv("ISAACUS_API_KEY", "sk-test");
    const probe = await probeDomainAdapter(async () => false);
    expect(probe.adapter.label).toBe("baseline");
    expect(probe.configured).toBe(true);
    expect(probe.reachable).toBe(false);
    expect(probe.detail).toContain("unreachable");
  });

  it("selects the provider-interpolated adapter when configured and reachable", async () => {
    vi.stubEnv("ISAACUS_API_KEY", "sk-test");
    const probe = await probeDomainAdapter(async () => true);
    expect(probe.adapter.label).toBe("Isaacus-enhanced");
    expect(probe.adapter.canRerank).toBe(true);
    expect(probe.adapter.canExtractiveQA).toBe(true);
    expect(probe.configured).toBe(true);
    expect(probe.reachable).toBe(true);
  });

  it("never uses free/premium or basic/pro framing anywhere", async () => {
    vi.stubEnv("ISAACUS_API_KEY", "sk-test");
    const reachable = await probeDomainAdapter(async () => true);
    const unreachable = await probeDomainAdapter(async () => false);
    const blob = JSON.stringify({
      reachable: { label: reachable.adapter.label, detail: reachable.detail },
      unreachable: { label: unreachable.adapter.label, detail: unreachable.detail },
      baseline: baselineAdapter.label,
    }).toLowerCase();
    for (const banned of ["free", "premium", "basic", "pro tier", "upgrade"]) {
      expect(blob).not.toContain(banned);
    }
  });
});

describe("Isaacus adapter rerank (skeleton, mocked transport)", () => {
  it("reorders LOCAL chunks by the provider response and degrades on error", async () => {
    vi.stubEnv("ISAACUS_API_KEY", "sk-test");
    const cfg = readIsaacusConfig()!;
    const adapter = buildIsaacusAdapter(cfg);
    const chunks: LocalChunk[] = [
      { chunk_id: "a", text: "alpha", score: 0.9 },
      { chunk_id: "b", text: "beta", score: 0.8 },
    ];

    // Mock fetch: reverse the order.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { index: 1, score: 0.99 },
            { index: 0, score: 0.5 },
          ],
        }),
        {
          status: 200,
        },
      ),
    );
    const reordered = await adapter.rerank!("q", chunks);
    expect(reordered.map((c) => c.chunk_id)).toEqual(["b", "a"]);
    fetchSpy.mockRestore();

    // On a network error, rerank returns the input order unchanged.
    const errSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));
    const fallback = await adapter.rerank!("q", chunks);
    expect(fallback.map((c) => c.chunk_id)).toEqual(["a", "b"]);
    errSpy.mockRestore();
  });
});

describe("probeCapabilities", () => {
  it("reports duckdb/local_embeddings flags and module counts", async () => {
    installFixture(scratch, "fixture");
    discoverModules(true);
    vi.stubEnv("ISAACUS_API_KEY", undefined);
    const caps = await probeCapabilities(async () => false);
    expect(typeof caps.duckdb).toBe("boolean");
    expect(typeof caps.local_embeddings).toBe("boolean");
    expect(caps.modules.ready).toBe(1);
    expect(caps.modules.refused).toBe(0);
    expect(caps.domain_adapter.label).toBe("baseline");
    expect(caps.domain_adapter.configured).toBe(false);
  });

  it("reports the provider-interpolated adapter when reachable", async () => {
    discoverModules(true);
    vi.stubEnv("ISAACUS_API_KEY", "sk-test");
    const caps = await probeCapabilities(async () => true);
    expect(caps.domain_adapter.label).toBe("Isaacus-enhanced");
    expect(caps.domain_adapter.canRerank).toBe(true);
  });
});

describe("semantic_search_local adapter refinement", () => {
  it.skipIf(!duckdbAvailable)("reranks the local top-k and tags metadata.enhancement", async () => {
    installFixture(scratch, "fixture-embedded");
    discoverModules(true);
    setQueryEmbedderForTest(async () => Float32Array.from([1, 0, 0, 0]), {
      model_id: "fixture-toy-4d",
      dim: 4,
    });
    // A stub adapter that reverses the order.
    const stubAdapter = {
      canRerank: true,
      canExtractiveQA: false,
      label: "Isaacus-enhanced",
      async rerank(_q: string, chunks: LocalChunk[]): Promise<LocalChunk[]> {
        return [...chunks].reverse();
      },
    };
    const r = await semanticSearchLocal({ query: "x" }, stubAdapter);
    expect(r.found).toBe(true);
    expect(r.hits[0]!.metadata.enhancement).toBe("Isaacus-enhanced");
    // The reversed order means the previously-last cosine hit is now first.
    expect(r.hits[0]!.provision_ref).not.toBe("s 18");
  });

  it.skipIf(!duckdbAvailable)(
    "leaves cosine order untouched under the baseline adapter",
    async () => {
      installFixture(scratch, "fixture-embedded");
      discoverModules(true);
      setQueryEmbedderForTest(async () => Float32Array.from([1, 0, 0, 0]), {
        model_id: "fixture-toy-4d",
        dim: 4,
      });
      const r = await semanticSearchLocal({ query: "x" }, baselineAdapter);
      expect(r.hits[0]!.provision_ref).toBe("s 18");
      expect(r.hits[0]!.metadata.enhancement).toBeUndefined();
    },
  );
});
