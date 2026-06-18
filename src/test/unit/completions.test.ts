import { describe, expect, it } from "vitest";

import {
  buildCompletionModel,
  escapeAnsiCString,
  escapeFishSingleQuoted,
  isUnsafeTerminalCode,
  renderBashCompletion,
  renderFishCompletion,
  renderZshCompletion,
} from "../../commands/completions.js";

const hostileValues = [
  "quote'value",
  '"double"',
  "$(touch /tmp/jurisd)",
  "$HOME",
  "`id`",
  "-leading",
  "white space",
  "line\nbreak",
  "\u001b]0;title\u0007",
  "\rreturn",
  "\u202ereversed",
];

const BIDI_CONTROL_CODES = [
  0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
];

function hasUnsafeTerminalCode(value: string, allowLineFeed = false): boolean {
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (allowLineFeed && code === 0x0a) continue;
    if (isUnsafeTerminalCode(code)) return true;
  }
  return false;
}

describe("shell completion generation", () => {
  it("treats every named bidi-control code point as unsafe", () => {
    for (const code of BIDI_CONTROL_CODES) {
      expect(isUnsafeTerminalCode(code)).toBe(true);
    }
  });

  it("generates root commands and command flags from command contracts", () => {
    const model = buildCompletionModel();
    expect(model.rootCommands).toContain("search-cases");
    expect(model.rootCommands).toContain("completion");
    expect(model.commandCandidates["search-cases"]).toContain("--limit");
    expect(model.commandCandidates.completion).toEqual(
      expect.arrayContaining(["bash", "fish", "zsh"]),
    );
  });

  it("renders static bash, zsh, and fish completion scripts", () => {
    const bash = renderBashCompletion();
    const zsh = renderZshCompletion();
    const fish = renderFishCompletion();

    expect(bash).toContain("complete -F _jurisd_complete jurisd");
    expect(zsh).toContain("#compdef jurisd");
    expect(fish).toContain("complete -c jurisd");
    expect(`${bash}\n${zsh}\n${fish}`).not.toContain("eval ");
    expect(`${bash}\n${zsh}\n${fish}`).not.toContain("$(");
  });

  it("renders hostile completion candidates without terminal controls", () => {
    const model = {
      rootCommands: hostileValues,
      commandCandidates: {
        safe: hostileValues.map((value) => `--${value}`),
      },
    };
    const output = [
      renderBashCompletion(model),
      renderZshCompletion(model),
      renderFishCompletion(model),
    ].join("\n");

    expect(output).not.toContain("eval ");
    expect(hasUnsafeTerminalCode(output, true)).toBe(false);
  });

  it("escapes shell metacharacters and strips terminal controls before rendering", () => {
    for (const value of hostileValues) {
      const bashOrZsh = escapeAnsiCString(value);
      const fish = escapeFishSingleQuoted(value);
      expect(hasUnsafeTerminalCode(bashOrZsh)).toBe(false);
      expect(hasUnsafeTerminalCode(fish)).toBe(false);
      expect(bashOrZsh).toMatch(/^\$'.*'$/u);
      expect(fish).toMatch(/^'.*'$/u);
    }
  });
});
