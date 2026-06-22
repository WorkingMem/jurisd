import { Readable, Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  renderCommandOutput,
  renderCommandPalette,
  renderTuiHeader,
  renderTuiHelp,
  renderTuiToolResult,
  resolveTuiCommand,
  runTui,
  sanitizeTerminalText,
  splitCommandLine,
  type TuiCommandExecutor,
} from "../../tui.js";
import { getCommandContractByCliName } from "../../commands/contracts.js";
import type { ToolExecutionResult } from "../../commands/tool-loopback.js";

const BIDI_CONTROL_CODES = [
  0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
];

class StringWritable extends Writable {
  value = "";

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error) => void) {
    this.value += chunk.toString();
    callback();
  }
}

describe("TUI shell", () => {
  it("renders an inline shell without claiming future panes are implemented", () => {
    const header = renderTuiHeader(120);
    expect(header).toContain("jurisd TUI shell");
    expect(header).toContain("Node readline");
    expect(header).toContain("search-cases");
    expect(header).not.toContain("agentic");
  });

  it("renders a grouped command palette sourced from command contracts", () => {
    const palette = renderCommandPalette(120);
    expect(palette).toContain("corpus:");
    expect(palette).toContain("/list-data-modules (corpus.listDataModules, local read)");
    expect(palette).toContain("/format-citation (cite.format, local read; pinpoint confirm)");
    expect(palette).toContain("search:");
    expect(palette).toContain("/search-cases (search.cases, web read)");
    expect(palette).not.toContain("tui.open /tui");
    expect(palette).not.toContain("source.fetchDocument /fetch-document-text");
    expect(palette).not.toContain("/bibliography");
  });

  it("resolves slash commands by governed id and CLI name", () => {
    expect(resolveTuiCommand("corpus.listDataModules")?.id).toBe("corpus.listDataModules");
    expect(resolveTuiCommand("list-data-modules")?.id).toBe("corpus.listDataModules");
    expect(resolveTuiCommand("search.cases")?.id).toBe("search.cases");
    expect(resolveTuiCommand("search-cases")?.id).toBe("search.cases");
    expect(resolveTuiCommand("get-provision")?.id).toBe("corpus.getProvision");
    expect(resolveTuiCommand("fetch-document-text")).toBeUndefined();
    expect(resolveTuiCommand("bibliography")).toBeUndefined();
  });

  it("splits quoted slash command arguments", () => {
    expect(splitCommandLine('format-citation "Mabo v Queensland (No 2)" --mode full')).toEqual([
      "format-citation",
      "Mabo v Queensland (No 2)",
      "--mode",
      "full",
    ]);
  });

  it("renders generic and per-command help", () => {
    expect(renderTuiHelp()).toContain("Use /commands");
    const help = renderTuiHelp("search-cases");
    expect(help).toContain("Search Australian and New Zealand case law.");
    expect(help).toContain("TUI: enabled (web read)");
    const formatHelp = renderTuiHelp("format-citation");
    expect(formatHelp).toContain("TUI: enabled (local read; pinpoint confirm)");
    expect(formatHelp).toContain("mode=pinpoint fetches the supplied URL");
    expect(renderTuiHelp("fetch-document-text")).toContain("TUI: not enabled");
  });

  it("runs a registry-backed slash command in inline mode", async () => {
    const input = Readable.from(["/corpus.listDataModules\n", "/quit\n"]);
    const output = new StringWritable();
    const executor: TuiCommandExecutor = async () => ({
      text: JSON.stringify({ count: 0, modules: [] }, null, 2),
      isError: false,
      rawResult: {},
    });

    await runTui({ input, output, columns: 64, executor });

    expect(output.value).toContain("dispatch: corpus.listDataModules");
    expect(output.value).toContain("Local data modules: 0");
    expect(output.value).toContain("goodbye");
  });

  it("dispatches search cases and legislation through the TUI with readable degraded status", async () => {
    const input = Readable.from([
      '/search-cases "Mabo" --limit 3\n',
      '/search.legislation "privacy" --jurisdiction cth --limit 3\n',
      "/quit\n",
    ]);
    const output = new StringWritable();
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const executor: TuiCommandExecutor = async (command, args) => {
      calls.push({ tool: command.tool, args });
      if (command.tool === "search_cases") {
        return {
          text: JSON.stringify(
            {
              degraded: true,
              warnings: [
                {
                  code: "jade_not_configured",
                  source: "jade",
                  message: "Jade search is not configured.",
                },
              ],
              sources: { austlii: "ok", jade: "not_configured" },
              results: [
                {
                  title: "Mabo v Queensland (No 2)",
                  neutralCitation: "[1992] HCA 23",
                  url: "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
                  source: "austlii",
                  type: "case",
                  jurisdiction: "cth",
                  year: "1992",
                },
              ],
            },
            null,
            2,
          ),
          isError: false,
          rawResult: {},
        };
      }
      return {
        text: JSON.stringify(
          [
            {
              title: "Privacy Act 1988 (Cth)",
              citation: "Privacy Act 1988 (Cth)",
              url: "https://www.austlii.edu.au/au/legis/cth/consol_act/pa1988108/",
              source: "austlii",
              type: "legislation",
              jurisdiction: "cth",
            },
          ],
          null,
          2,
        ),
        isError: false,
        rawResult: {},
      };
    };

    await runTui({ input, output, columns: 100, executor });

    expect(calls).toEqual([
      { tool: "search_cases", args: { query: "Mabo", limit: 3 } },
      {
        tool: "search_legislation",
        args: { query: "privacy", jurisdiction: "cth", limit: 3 },
      },
    ]);
    expect(output.value).toContain("dispatch: search.cases");
    expect(output.value).toContain("Search cases results: 1");
    expect(output.value).toContain("DEGRADED");
    expect(output.value).toContain("Sources: austlii=ok, jade=not_configured");
    expect(output.value).toContain("Mabo v Queensland (No 2)");
    expect(output.value).toContain("dispatch: search.legislation");
    expect(output.value).toContain("Search legislation results: 1");
    expect(output.value).toContain("Privacy Act 1988 (Cth)");
  });

  it("keeps non-pinpoint format-citation available as a local read", async () => {
    const input = Readable.from([
      '/format-citation "Mabo v Queensland (No 2)" --neutral-citation "[1992] HCA 23"\n',
      "/quit\n",
    ]);
    const output = new StringWritable();
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const executor: TuiCommandExecutor = async (command, args) => {
      calls.push({ tool: command.tool, args });
      return {
        text: "Mabo v Queensland (No 2) [1992] HCA 23\n",
        isError: false,
        rawResult: {},
      };
    };

    await runTui({ input, output, columns: 100, executor });

    expect(calls).toEqual([
      {
        tool: "format_citation",
        args: {
          title: "Mabo v Queensland (No 2)",
          neutralCitation: "[1992] HCA 23",
        },
      },
    ]);
    expect(output.value).toContain("dispatch: cite.format");
    expect(output.value).toContain("Mabo v Queensland (No 2) [1992] HCA 23");
    expect(output.value).not.toContain("confirmation required");
  });

  it("does not dispatch pinpoint format-citation without network-read confirmation", async () => {
    const input = Readable.from([
      "/format-citation --mode pinpoint --url https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html --paragraph-number 1\n",
      "/quit\n",
    ]);
    const output = new StringWritable();
    let executed = false;

    await runTui({
      input,
      output,
      columns: 120,
      executor: async () => {
        executed = true;
        throw new Error("unconfirmed pinpoint should not execute");
      },
    });

    expect(executed).toBe(false);
    expect(output.value).toContain("confirmation required: cite.format mode=pinpoint");
    expect(output.value).toContain("re-run the command with --confirm-network-read");
    expect(output.value).not.toContain("dispatch: cite.format");
  });

  it("dispatches confirmed pinpoint format-citation through the network-read path", async () => {
    const input = Readable.from([
      "/format-citation --mode pinpoint --url https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html --paragraph-number 1 --confirm-network-read\n",
      "/quit\n",
    ]);
    const output = new StringWritable();
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const executor: TuiCommandExecutor = async (command, args) => {
      calls.push({ tool: command.tool, args });
      return {
        text: JSON.stringify({ fullCitation: "[1]" }),
        isError: false,
        rawResult: {},
      };
    };

    await runTui({ input, output, columns: 120, executor });

    expect(calls).toEqual([
      {
        tool: "format_citation",
        args: {
          mode: "pinpoint",
          url: "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
          paragraphNumber: 1,
        },
      },
    ]);
    expect(output.value).toContain("confirmed network read: cite.format mode=pinpoint");
    expect(output.value).toContain("dispatch: cite.format");
    expect(output.value).toContain('"fullCitation":"[1]"');
  });

  it("reaches local recall commands with graceful missing-corpus output", async () => {
    const input = Readable.from([
      '/get-provision "Competition and Consumer Act 2010 (Cth)" "s 18"\n',
      "/quit\n",
    ]);
    const output = new StringWritable();
    const executor: TuiCommandExecutor = async () => ({
      text: JSON.stringify({ found: false }, null, 2),
      isError: false,
      rawResult: {},
    });

    await runTui({ input, output, columns: 96, executor });

    expect(output.value).toContain("dispatch: corpus.getProvision");
    expect(output.value).toContain("Local provision lookup: not found");
  });

  it("rejects registered commands that are not enabled for TUI dispatch", async () => {
    const input = Readable.from(["/fetch-document-text https://example.com\n", "/quit\n"]);
    const output = new StringWritable();
    let executed = false;

    await runTui({
      input,
      output,
      columns: 96,
      executor: async () => {
        executed = true;
        throw new Error("blocked command should not execute");
      },
    });

    expect(output.value).toContain("registered command source.fetchDocument is not enabled");
    expect(output.value).not.toContain("dispatch: source.fetchDocument");
    expect(executed).toBe(false);
  });

  it("renders known command JSON into terminal-readable sections", () => {
    const contract = getCommandContractByCliName("search-legislation");
    if (!contract) throw new Error("missing search-legislation contract");
    const result: ToolExecutionResult = {
      text: JSON.stringify(
        {
          degraded: true,
          sources: { austlii: "blocked", exa: "failed" },
          warnings: [
            {
              code: "austlii_cloudflare_blocked",
              source: "austlii",
              message: "AustLII search is blocked by a Cloudflare challenge.",
            },
          ],
          results: [],
        },
        null,
        2,
      ),
      isError: false,
      rawResult: {},
    };

    const rendered = renderTuiToolResult(contract, result);

    expect(rendered).toContain("Search legislation results: 0");
    expect(rendered).toContain("DEGRADED");
    expect(rendered).toContain("Sources: austlii=blocked, exa=failed");
    expect(rendered).toContain("AustLII search is blocked");
  });

  it("preserves long command output instead of width-truncating it", () => {
    const longLine = `{"value":"${"x".repeat(120)}"}`;
    const rendered = renderCommandOutput(longLine);

    expect(rendered).toContain(longLine);
    expect(rendered).not.toContain("...");
  });

  it("strips terminal control characters before displaying transcript or command output", () => {
    expect(sanitizeTerminalText("safe\u001b[2J\u001b[31m text\u0007")).toBe("safe text");
    expect(renderCommandOutput("alpha\rbravo\u001b]0;title\u0007charlie")).toBe(
      "alpha\nbravocharlie\n",
    );
    expect(sanitizeTerminalText("safe\u001bPpayload\u001b\\text")).toBe("safetext");
    expect(sanitizeTerminalText("safe\u001b^payload\u0007text")).toBe("safetext");
    expect(sanitizeTerminalText("safe\u001b_payload\u001b\\text")).toBe("safetext");
  });

  it("strips Unicode bidi controls before displaying command output", () => {
    const allBidiControls = String.fromCodePoint(...BIDI_CONTROL_CODES);

    expect(sanitizeTerminalText(`alpha${allBidiControls}bravo`)).toBe("alphabravo");
    expect(renderCommandOutput(`module${allBidiControls}-name`)).toBe("module-name\n");
  });
});
