#!/usr/bin/env tsx

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderCompletion, SUPPORTED_COMPLETION_SHELLS } from "../src/commands/completions.js";
import { renderCommandReference } from "../src/commands/reference.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

type Artifact = {
  path: string;
  contents: string;
};

function artifactPath(relativePath: string): string {
  return join(ROOT, relativePath);
}

function artifacts(): Artifact[] {
  return [
    {
      path: "docs/generated/COMMANDS.md",
      contents: renderCommandReference(),
    },
    ...SUPPORTED_COMPLETION_SHELLS.map((shell) => ({
      path: `docs/generated/completions/jurisd.${shell}`,
      contents: renderCompletion(shell),
    })),
  ];
}

function writeArtifacts(items: Artifact[]): void {
  for (const item of items) {
    const target = artifactPath(item.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, item.contents, "utf8");
  }
}

function checkArtifacts(items: Artifact[]): string[] {
  const stale: string[] = [];
  for (const item of items) {
    const target = artifactPath(item.path);
    const current = existsSync(target) ? readFileSync(target, "utf8") : "";
    if (current !== item.contents) stale.push(item.path);
  }
  return stale;
}

const items = artifacts();
if (process.argv.includes("--check")) {
  const stale = checkArtifacts(items);
  if (stale.length > 0) {
    console.error("Generated command artifacts are stale:");
    for (const path of stale) console.error(`  ${path}`);
    console.error("Run `npm run generate:commands` and commit the result.");
    process.exitCode = 1;
  }
} else {
  writeArtifacts(items);
}
