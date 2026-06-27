import { Readable, Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

const toolMocks = vi.hoisted(() => ({
  executeToolCommand: vi.fn(),
}));

vi.mock("../../commands/tool-loopback.js", () => ({
  executeToolCommand: toolMocks.executeToolCommand,
}));

import { runCli } from "../../cli.js";

class StringWritable extends Writable {
  value = "";

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error) => void) {
    this.value += chunk.toString();
    callback();
  }
}

const stdinDescriptor = Object.getOwnPropertyDescriptor(process, "stdin");
const stdoutDescriptor = Object.getOwnPropertyDescriptor(process, "stdout");

function restoreProcessStreams(): void {
  if (stdinDescriptor) Object.defineProperty(process, "stdin", stdinDescriptor);
  if (stdoutDescriptor) Object.defineProperty(process, "stdout", stdoutDescriptor);
}

describe("jurisd tui CLI dispatch smoke", () => {
  afterEach(() => {
    toolMocks.executeToolCommand.mockReset();
    restoreProcessStreams();
    process.exitCode = 0;
  });

  it("dispatches web search slash commands from the CLI TUI entrypoint", async () => {
    const input = Readable.from([
      '/search-cases "Mabo" --limit 3\n',
      '/search-legislation "privacy" --jurisdiction cth --limit 3\n',
      "/quit\n",
    ]);
    const output = new StringWritable();
    Object.defineProperty(process, "stdin", { configurable: true, value: input });
    Object.defineProperty(process, "stdout", { configurable: true, value: output });

    toolMocks.executeToolCommand.mockImplementation(async (command: { tool: string }) => {
      if (command.tool === "search_cases") {
        return {
          text: JSON.stringify(
            {
              degraded: true,
              sources: { austlii: "blocked", exa: "not_configured" },
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
    });

    const handled = await runCli(["tui"]);

    expect(handled).toBe(true);
    expect(process.exitCode).toBe(0);
    expect(toolMocks.executeToolCommand).toHaveBeenCalledTimes(2);
    expect(output.value).toContain("dispatch: search.cases");
    expect(output.value).toContain("Search cases results: 0");
    expect(output.value).toContain("DEGRADED");
    expect(output.value).toContain("Sources: austlii=blocked, exa=not_configured");
    expect(output.value).toContain("dispatch: search.legislation");
    expect(output.value).toContain("Search legislation results: 1");
    expect(output.value).toContain("Privacy Act 1988 (Cth)");
    expect(output.value).toContain("goodbye");
  });
});
