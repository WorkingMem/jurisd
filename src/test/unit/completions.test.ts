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

function hasUnsafeTerminalCode(value: string, allowLineFeed = false): boolean {
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (allowLineFeed && code === 0x0a) continue;
    if (isUnsafeTerminalCode(code)) return true;
  }
  return false;
}

describe("shell completion generation", () => {
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
