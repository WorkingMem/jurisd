import { Readable, Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  renderCommandOutput,
  renderCommandPalette,
  renderTuiHeader,
  resolveTuiCommand,
  runTui,
  sanitizeTerminalText,
  splitCommandLine,
} from "../../tui.js";

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

describe("TUI scaffold", () => {
  it("renders an inline scaffold without claiming future panes are implemented", () => {
    const header = renderTuiHeader(120);
    expect(header).toContain("jurisd TUI scaffold");
    expect(header).toContain("Node readline");
    expect(header).toContain("inactive placeholders");
  });

  it("renders a command palette sourced from command contracts", () => {
    const palette = renderCommandPalette(120);
    expect(palette).toContain("corpus.listDataModules /list-data-modules");
    expect(palette).not.toContain("tui.open /tui");
    expect(palette).not.toContain("source.fetchDocument /fetch-document-text");
  });

  it("resolves slash commands by governed id and CLI name", () => {
    expect(resolveTuiCommand("corpus.listDataModules")?.id).toBe("corpus.listDataModules");
    expect(resolveTuiCommand("list-data-modules")?.id).toBe("corpus.listDataModules");
    expect(resolveTuiCommand("fetch-document-text")).toBeUndefined();
  });

  it("splits quoted slash command arguments", () => {
    expect(splitCommandLine('format-citation "Mabo v Queensland (No 2)" --mode full')).toEqual([
      "format-citation",
      "Mabo v Queensland (No 2)",
      "--mode",
      "full",
    ]);
  });

  it("runs a registry-backed slash command in inline mode", async () => {
    const input = Readable.from(["/corpus.listDataModules\n", "/quit\n"]);
    const output = new StringWritable();

    await runTui({ input, output, columns: 64 });

    expect(output.value).toContain("dispatch: corpus.listDataModules");
    expect(output.value).toContain('"count"');
    expect(output.value).toContain("goodbye");
  });

  it("rejects registered commands that are not enabled for TUI dispatch", async () => {
    const input = Readable.from(["/fetch-document-text https://example.com\n", "/quit\n"]);
    const output = new StringWritable();

    await runTui({ input, output, columns: 96 });

    expect(output.value).toContain("registered command source.fetchDocument is not enabled");
    expect(output.value).not.toContain("dispatch: source.fetchDocument");
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
  });

  it("strips Unicode bidi controls before displaying command output", () => {
    const allBidiControls = String.fromCodePoint(...BIDI_CONTROL_CODES);

    expect(sanitizeTerminalText(`alpha${allBidiControls}bravo`)).toBe("alphabravo");
    expect(renderCommandOutput(`module${allBidiControls}-name`)).toBe("module-name\n");
  });
});
