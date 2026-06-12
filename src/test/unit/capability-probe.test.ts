import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { probeCapabilities } from "../../services/capabilities.js";
import { probeDomainAdapter, resetAdapterState } from "../../services/adapter.js";
import { setModulesRootForTest, discoverModules } from "../../services/modules.js";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "wse-probe-"));
  setModulesRootForTest(root, true);
  resetAdapterState();
  delete process.env.ISAACUS_API_KEY;
  delete process.env.ISAACUS_BASE_URL;
});
afterEach(() => {
  setModulesRootForTest(null);
  resetAdapterState();
  delete process.env.ISAACUS_API_KEY;
  delete process.env.ISAACUS_BASE_URL;
});

describe("WS-E capability probe — baseline vs domain adapter (design §4)", () => {
  it("no key → baseline, fully offline, configured=false", async () => {
    discoverModules(true);
    // Override is irrelevant when no key is set; the adapter never reaches out.
    const caps = await probeCapabilities(async () => true);
    expect(caps.domain_adapter.label).toBe("baseline");
    expect(caps.domain_adapter.configured).toBe(false);
    expect(caps.domain_adapter.reachable).toBe(false);
    expect(caps.domain_adapter.canRerank).toBe(false);
    expect(caps.domain_adapter.canExtractiveQA).toBe(false);
  });

  it("fake key + reachable → provider-interpolated label, capabilities on", async () => {
    process.env.ISAACUS_API_KEY = "sk-fake-review";
    discoverModules(true);
    const caps = await probeCapabilities(async () => true);
    expect(caps.domain_adapter.label).toBe("Isaacus-enhanced");
    expect(caps.domain_adapter.configured).toBe(true);
    expect(caps.domain_adapter.reachable).toBe(true);
    expect(caps.domain_adapter.canRerank).toBe(true);
    expect(caps.domain_adapter.canExtractiveQA).toBe(true);
  });

  it("fake key + unreachable → degrades to baseline, no crash", async () => {
    process.env.ISAACUS_API_KEY = "sk-fake-review";
    discoverModules(true);
    const caps = await probeCapabilities(async () => false);
    expect(caps.domain_adapter.label).toBe("baseline");
    expect(caps.domain_adapter.configured).toBe(true);
    expect(caps.domain_adapter.reachable).toBe(false);
    expect(caps.domain_adapter.detail).toBeTruthy();
  });

  it("probe always reports the structural data-layer flags", async () => {
    discoverModules(true);
    const caps = await probeCapabilities(async () => false);
    expect(typeof caps.duckdb).toBe("boolean");
    expect(typeof caps.local_embeddings).toBe("boolean");
    expect(caps.modules).toMatchObject({ ready: expect.any(Number), refused: expect.any(Number) });
  });

  it("fake key + REAL network to a black-hole host degrades to baseline within budget (no hang)", async () => {
    process.env.ISAACUS_API_KEY = "sk-fake-review";
    // TEST-NET-1 (RFC5737) is non-routable: the connect stalls until the
    // adapter's 3s AbortController fires. Asserts the no-hang guarantee.
    process.env.ISAACUS_BASE_URL = "http://192.0.2.1:81/v1";
    const t0 = Date.now();
    const probe = await probeDomainAdapter(); // REAL isReachable, no override
    const dt = Date.now() - t0;
    expect(probe.adapter.label).toBe("baseline");
    expect(probe.configured).toBe(true);
    expect(probe.reachable).toBe(false);
    expect(dt).toBeLessThan(6000); // 3s timeout + slack
  }, 15000);
});
