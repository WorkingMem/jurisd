import { describe, expect, it } from "vitest";

import { getCommandContractByCliName } from "../../commands/contracts.js";
import { renderCommandHelp, renderTopLevelHelp } from "../../commands/help.js";

describe("CLI help rendering", () => {
  it("renders task-oriented top-level help", () => {
    const help = renderTopLevelHelp();
    expect(help).toContain("jurisd");
    expect(help).toContain("search");
    expect(help).toContain("cite");
    expect(help).toContain("mcp");
    expect(help).toContain("Run `jurisd help <topic>`");
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
});
