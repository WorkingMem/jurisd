import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { getCommandContractByCliName } from "../../commands/contracts.js";
import { parseFlags } from "../../commands/argv.js";
import { contractToToolCommand } from "../../commands/legacy-cli.js";
import { runCli, mapArgvToToolInput } from "../../cli.js";
import { setModulesRootForTest } from "../../services/modules.js";
import { CloudflareBlockedError } from "../../errors.js";
import type { SearchResult } from "../../services/austlii.js";

const toolMocks = vi.hoisted(() => ({
  searchAustLii: vi.fn(),
  searchUpstreamWithStatus: vi.fn(),
  fetchDocumentText: vi.fn(),
}));

vi.mock("../../services/austlii.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/austlii.js")>();
  return { ...actual, searchAustLii: toolMocks.searchAustLii };
});

vi.mock("../../services/source.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/source.js")>();
  return { ...actual, searchUpstreamWithStatus: toolMocks.searchUpstreamWithStatus };
});

vi.mock("../../services/fetcher.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/fetcher.js")>();
  return { ...actual, fetchDocumentText: toolMocks.fetchDocumentText };
});

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

  it("coerces boolean literals case-insensitively after parsing", () => {
    const args = mapArgvToToolInput(listDataModulesCmd, [], {
      refresh: "TRUE",
      includeInvalid: "FALSE",
    });
    expect(args.refresh).toBe(true);
    expect(args.includeInvalid).toBe(false);
  });

  it("keeps adjacent bare boolean flags distinct when parsing with a command schema", () => {
    const parsed = parseFlags(
      ["--refresh", "--include-invalid", "--format", "json"],
      listDataModulesCmd.boolean,
    );
    const args = mapArgvToToolInput(listDataModulesCmd, parsed.positional, parsed.flags);

    expect(parsed.flags).toEqual({
      refresh: "",
      "include-invalid": "",
      format: "json",
    });
    expect(args.refresh).toBe(true);
    expect(args.includeInvalid).toBe(true);
    expect(args.format).toBe("json");
  });

  it("does not treat unsupported boolean values as bare true flags", () => {
    const parsed = parseFlags(["--include-invalid", "0"], listDataModulesCmd.boolean);
    const args = mapArgvToToolInput(listDataModulesCmd, parsed.positional, parsed.flags);

    expect(parsed.flags).toEqual({ "include-invalid": "false" });
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

  it("handles tui help without starting the server", async () => {
    const handled = await runCli(["tui", "--help"]);
    expect(handled).toBe(true);
    expect(process.exitCode).toBe(0);
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
  let errors: string[];

  beforeEach(() => {
    process.exitCode = 0;
    toolMocks.searchAustLii.mockReset();
    toolMocks.searchUpstreamWithStatus.mockReset();
    toolMocks.fetchDocumentText.mockReset();
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "jurisd-cli-"));
    setModulesRootForTest(scratch, true);
    written = "";
    errors = [];
    stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      written += String(chunk);
      return true;
    });
    stderr = vi.spyOn(console, "error").mockImplementation((...chunks: unknown[]) => {
      errors.push(chunks.map(String).join(" "));
    });
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

  it("sets exitCode 4 when a search response is source-degraded", async () => {
    toolMocks.searchAustLii.mockRejectedValueOnce(
      new CloudflareBlockedError("https://www.austlii.edu.au/cgi-bin/sinosrch.cgi", false),
    );

    const handled = await runCli(["search-legislation", "privacy", "--format", "json"]);
    expect(handled).toBe(true);
    expect(process.exitCode).toBe(4);
    const parsed = JSON.parse(written) as { degraded: boolean; sources: Record<string, string> };
    expect(parsed.degraded).toBe(true);
    expect(parsed.sources).toEqual({ austlii: "blocked" });
  });

  it("sets exitCode 4 when search-case coverage is incomplete", async () => {
    const austliiResult: SearchResult = {
      title: "Mabo v Queensland (No 2)",
      neutralCitation: "[1992] HCA 23",
      url: "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
      source: "austlii",
      type: "case",
      jurisdiction: "cth",
      year: "1992",
    };
    toolMocks.searchAustLii.mockResolvedValueOnce([austliiResult]);
    toolMocks.searchUpstreamWithStatus.mockResolvedValueOnce({
      results: [],
      status: "not_configured",
    });

    const handled = await runCli(["search-cases", "Mabo", "--format", "json"]);
    expect(handled).toBe(true);
    expect(process.exitCode).toBe(4);
    const parsed = JSON.parse(written) as {
      degraded: boolean;
      sources: Record<string, string>;
      results: SearchResult[];
    };
    expect(parsed.degraded).toBe(true);
    expect(parsed.sources).toEqual({ austlii: "ok", source: "not_configured" });
    expect(parsed.results[0]!.source).toBe("austlii");
  });

  it("sets exitCode 4 when search-case source coverage fails", async () => {
    const austliiResult: SearchResult = {
      title: "Mabo v Queensland (No 2)",
      neutralCitation: "[1992] HCA 23",
      url: "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
      source: "austlii",
      type: "case",
      jurisdiction: "cth",
      year: "1992",
    };
    toolMocks.searchAustLii.mockResolvedValueOnce([austliiResult]);
    toolMocks.searchUpstreamWithStatus.mockResolvedValueOnce({
      results: [],
      status: "failed",
    });

    const handled = await runCli(["search-cases", "Mabo", "--format", "json"]);
    expect(handled).toBe(true);
    expect(process.exitCode).toBe(4);
    const parsed = JSON.parse(written) as {
      degraded: boolean;
      sources: Record<string, string>;
      results: SearchResult[];
    };
    expect(parsed.degraded).toBe(true);
    expect(parsed.sources).toEqual({ austlii: "ok", source: "failed" });
    expect(parsed.results[0]!.source).toBe("austlii");
  });

  it("does not treat fetched source text as degraded CLI metadata", async () => {
    toolMocks.fetchDocumentText.mockResolvedValueOnce({
      text: '{"degraded":true}',
      contentType: "text/plain",
      sourceUrl: "https://example.test/source",
    });

    const handled = await runCli([
      "fetch-document-text",
      "https://example.test/source",
      "--format",
      "text",
    ]);
    expect(handled).toBe(true);
    expect(process.exitCode).toBe(0);
    expect(written).toContain('{"degraded":true}');
  });

  it("prints shell completion scripts to stdout with exit 0", async () => {
    const handled = await runCli(["completion", "zsh"]);
    expect(handled).toBe(true);
    expect(process.exitCode).toBe(0);
    expect(written).toContain("#compdef jurisd");
    expect(written).toContain("search-cases");
  });

  it("rejects unsupported completion shells with a usage error", async () => {
    const handled = await runCli(["completion", "powershell"]);
    expect(handled).toBe(true);
    expect(process.exitCode).toBe(2);
    expect(written).toBe("");
    expect(errors.join("\n")).toContain("unsupported completion shell");
  });

  it("does not echo unsupported completion shell input to diagnostics", async () => {
    const handled = await runCli(["completion", "\u001b]0;title\u0007powershell"]);
    expect(handled).toBe(true);
    expect(process.exitCode).toBe(2);
    const diagnostic = errors.join("\n");
    expect(diagnostic).toContain("unsupported completion shell");
    expect(diagnostic).not.toContain("title");
    expect(diagnostic).not.toContain("powershell");
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
