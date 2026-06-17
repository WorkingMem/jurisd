import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { getCommandContractByCliName } from "../../commands/contracts.js";
import { contractToToolCommand } from "../../commands/legacy-cli.js";
import { runCli, mapArgvToToolInput } from "../../cli.js";
import { setModulesRootForTest } from "../../services/modules.js";

/**
 * The argv -> tool-input mapping is exercised here independently of any live
 * loopback so the coercion rules can be asserted offline.
 */
const requiredToolCommand = (cliName: string) => {
  const contract = getCommandContractByCliName(cliName);
  if (!contract) throw new Error(`Missing command contract for ${cliName}`);
  return contractToToolCommand(contract);
};

const searchCasesCmd = requiredToolCommand("search-cases");
const resolveCitationCmd = requiredToolCommand("resolve-citation");
const findCitingCmd = requiredToolCommand("find-citing");
const listDataModulesCmd = requiredToolCommand("list-data-modules");
const semanticCmd = requiredToolCommand("semantic-search-local");

describe("mapArgvToToolInput", () => {
  it("assigns a positional to the first schema field", () => {
    const args = mapArgvToToolInput(searchCasesCmd, ["misleading conduct"], {});
    expect(args).toEqual({ query: "misleading conduct" });
  });

  it("coerces numeric flags to numbers", () => {
    const args = mapArgvToToolInput(searchCasesCmd, ["native title"], {
      limit: "5",
      offset: "50",
    });
    expect(args.query).toBe("native title");
    expect(args.limit).toBe(5);
    expect(args.offset).toBe(50);
    expect(typeof args.limit).toBe("number");
  });

  it("passes enum flags through as strings", () => {
    const args = mapArgvToToolInput(resolveCitationCmd, ["[1992] HCA 23"], {
      mode: "validate",
    });
    expect(args).toEqual({ citation: "[1992] HCA 23", mode: "validate" });
  });

  it("splits array flags on commas and trims", () => {
    const args = mapArgvToToolInput(findCitingCmd, ["Mabo v Queensland (No 2)"], {
      kinds: "cites, considers",
      limit: "20",
    });
    expect(args.kinds).toEqual(["cites", "considers"]);
    expect(args.limit).toBe(20);
  });

  it("coerces boolean flags, treating a bare flag as true", () => {
    const args = mapArgvToToolInput(listDataModulesCmd, [], {
      refresh: "",
      includeInvalid: "false",
    });
    expect(args.refresh).toBe(true);
    expect(args.includeInvalid).toBe(false);
  });

  it("folds --filter-<facet> flags into a nested filter object", () => {
    const args = mapArgvToToolInput(semanticCmd, ["restraint of trade"], {
      k: "3",
      "filter-jurisdiction": "cth",
      "filter-type": "primary_legislation",
    });
    expect(args.k).toBe(3);
    expect(args.filter).toEqual({ jurisdiction: "cth", type: "primary_legislation" });
  });

  it("ignores the loader-only --modules-dir flag", () => {
    const args = mapArgvToToolInput(searchCasesCmd, ["x"], { "modules-dir": "/tmp/x" });
    expect(args).toEqual({ query: "x" });
  });
});

describe("runCli routing", () => {
  beforeEach(() => {
    process.exitCode = 0;
  });
  afterEach(() => {
    process.exitCode = 0;
  });

  it("returns false when no command is given (server should start)", async () => {
    expect(await runCli([])).toBe(false);
  });

  it("returns false for an unknown command", async () => {
    expect(await runCli(["definitely-not-a-command"])).toBe(false);
  });

  it("returns false when the first arg is a flag", async () => {
    expect(await runCli(["--http"])).toBe(false);
  });

  it("resolves existing flat CLI tool commands from command contracts", () => {
    expect(getCommandContractByCliName("search-cases")?.adapters.mcp.toolName).toBe("search_cases");
    expect(getCommandContractByCliName("get-provision")?.adapters.mcp.toolName).toBe(
      "get_provision",
    );
  });
});

describe("runCli tool loopback (offline tools)", () => {
  let scratch: string;
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;
  let written: string;

  beforeEach(() => {
    process.exitCode = 0;
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "jurisd-cli-"));
    setModulesRootForTest(scratch, true);
    written = "";
    stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      written += String(chunk);
      return true;
    });
    stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
    setModulesRootForTest(null);
    fs.rmSync(scratch, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it("list-data-modules runs through the loopback to stdout with exit 0", async () => {
    const handled = await runCli(["list-data-modules"]);
    expect(handled).toBe(true);
    expect(process.exitCode).toBe(0);
    const parsed = JSON.parse(written) as { count: number; modules: unknown[] };
    expect(parsed.count).toBe(0);
    expect(parsed.modules).toEqual([]);
  });

  it("format-citation full mode formats a citation to stdout with exit 0", async () => {
    const handled = await runCli([
      "format-citation",
      "Mabo v Queensland (No 2)",
      "--neutral-citation",
      "[1992] HCA 23",
      "--reported-citation",
      "(1992) 175 CLR 1",
    ]);
    expect(handled).toBe(true);
    expect(process.exitCode).toBe(0);
    expect(written).toContain("Mabo v Queensland (No 2)");
    expect(written).toContain("[1992] HCA 23");
  });

  it("semantic-search-local degrades to a typed note with exit 0 when the embedder is absent", async () => {
    const handled = await runCli(["semantic-search-local", "restraint of trade"]);
    expect(handled).toBe(true);
    expect(process.exitCode).toBe(0);
    // Either a typed note (no embedder / no module) or an empty result set;
    // both are valid offline outcomes. The contract under test is that output
    // lands on stdout and the exit code is success.
    expect(written.length).toBeGreaterThan(0);
    const parsed = JSON.parse(written) as Record<string, unknown>;
    expect(parsed).toBeTypeOf("object");
  });

  it("sets exitCode 2 when a required positional is missing", async () => {
    const handled = await runCli(["get-provision"]);
    expect(handled).toBe(true);
    expect(process.exitCode).toBe(2);
    expect(written).toBe("");
  });

  it("sets exitCode 1 when the tool rejects invalid input (no network)", async () => {
    // A syntactically invalid URL fails the tool's `z.string().url()` schema
    // before the handler runs, so the loopback surfaces isError without any
    // network call — pinning the result.isError -> exit 1 branch.
    const handled = await runCli(["fetch-document-text", "not-a-valid-url"]);
    expect(handled).toBe(true);
    expect(process.exitCode).toBe(1);
  });
});
