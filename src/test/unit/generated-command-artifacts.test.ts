import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { renderCompletion, SUPPORTED_COMPLETION_SHELLS } from "../../commands/completions.js";
import { renderCommandReference } from "../../commands/reference.js";

describe("generated command artifacts", () => {
  it("keeps the generated command reference committed", () => {
    const path = join(process.cwd(), "docs/generated/COMMANDS.md");
    expect(readFileSync(path, "utf8")).toBe(renderCommandReference());
  });

  it("keeps generated shell completions committed", () => {
    for (const shell of SUPPORTED_COMPLETION_SHELLS) {
      const path = join(process.cwd(), `docs/generated/completions/jurisd.${shell}`);
      expect(readFileSync(path, "utf8")).toBe(renderCompletion(shell));
    }
  });
});
