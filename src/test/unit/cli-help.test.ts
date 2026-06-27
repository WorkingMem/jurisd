import { describe, expect, it } from "vitest";

import { getCommandContractByCliName } from "../../commands/contracts.js";
import { renderCommandHelp, renderTopLevelHelp } from "../../commands/help.js";

describe("CLI help rendering", () => {
  it("renders task-oriented top-level help derived from the command contracts", () => {
    const help = renderTopLevelHelp();
    expect(help).toContain("jurisd");
    expect(help).toContain("search");
    expect(help).toContain("cite");
    // Real, invokable commands must appear; the `modules` group in particular
    // was previously omitted from the hand-maintained help.
    expect(help).toContain("search-cases");
    expect(help).toContain("fetch-module");
    expect(help).toContain("completion");
    // `mcp serve` was never a real command — bare `jurisd` serves the MCP server.
    expect(help).not.toContain("mcp serve");
    expect(help).toContain("Run `jurisd help <command>`");
  });

  it("renders per-command help from a command contract", () => {
    const contract = getCommandContractByCliName("search-cases");
    expect(contract).toBeDefined();
    const help = renderCommandHelp(contract!);
    expect(help).toContain("Search Australian and New Zealand case law");
    expect(help).toContain("Usage:");
    expect(help).toContain("Examples:");
    expect(help).toContain("--limit");
  });

  it("renders completion help from the command contract", () => {
    const contract = getCommandContractByCliName("completion");
    expect(contract).toBeDefined();
    const help = renderCommandHelp(contract!);
    expect(help).toContain("Print a shell completion script");
    expect(help).toContain("jurisd completion <bash|zsh|fish>");
  });
});
