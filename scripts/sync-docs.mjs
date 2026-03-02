#!/usr/bin/env node

/**
 * sync-docs.mjs
 *
 * Scans the repository source tree and updates the Project Structure section
 * in README.md to reflect the current state of the codebase.
 *
 * Run manually:   node scripts/sync-docs.mjs
 * Run via CI:     Called by .github/workflows/docs-sync.yml
 */

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "fs";
import { join, relative } from "path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

// ── Helpers ──────────────────────────────────────────────────────────────

/** Recursively build a tree structure for a directory. */
function buildTree(dir, prefix = "", isLast = true) {
  const entries = readdirSync(dir)
    .filter((e) => !e.startsWith(".") && e !== "node_modules" && e !== "dist")
    .sort((a, b) => {
      const aIsDir = statSync(join(dir, a)).isDirectory();
      const bIsDir = statSync(join(dir, b)).isDirectory();
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a.localeCompare(b);
    });

  const lines = [];
  entries.forEach((entry, idx) => {
    const fullPath = join(dir, entry);
    const isDirectory = statSync(fullPath).isDirectory();
    const isLastEntry = idx === entries.length - 1;
    const connector = isLastEntry ? "└── " : "├── ";
    const annotation = getAnnotation(relative(ROOT, fullPath));

    lines.push(`${prefix}${connector}${entry}${annotation}`);

    if (isDirectory) {
      const childPrefix = prefix + (isLastEntry ? "    " : "│   ");
      lines.push(...buildTree(fullPath, childPrefix, isLastEntry));
    }
  });
  return lines;
}

/** Return a short comment describing well-known files. */
function getAnnotation(relPath) {
  const annotations = {
    "src/index.ts": " # MCP server & tool registration",
    "src/config.ts": " # Configuration management",
    "src/constants.ts": " # Shared constants",
    "src/errors.ts": " # Error types and handling",
    "src/services/austlii.ts": " # AustLII search integration",
    "src/services/fetcher.ts": " # Document text retrieval (HTML/PDF/OCR)",
    "src/services/source.ts": " # removed.invalid article resolution & citation lookup",
    "src/utils/formatter.ts": " # Output formatting (JSON/text/markdown/html)",
    "src/utils/logger.ts": " # Logging utility",
    "docs/DOCKER.md": " # Docker deployment guide",
    "docs/architecture.md": " # Architecture documentation",
    "docs/ROADMAP.md": " # Development roadmap",
    "k8s/namespace.yaml": " # Kubernetes namespace",
    "k8s/configmap.yaml": " # Configuration for k8s",
    "k8s/deployment.yaml": " # Deployment specification",
    "k8s/service.yaml": " # Service definition",
    "k8s/README.md": " # Kubernetes deployment guide",
  };
  return annotations[relPath] || "";
}

/** Generate the tree block for a top-level directory. */
function generateDirTree(dirName) {
  const dirPath = join(ROOT, dirName);
  if (!existsSync(dirPath)) return null;
  const lines = buildTree(dirPath);
  return `${dirName}/\n${lines.join("\n")}`;
}

// ── Main ─────────────────────────────────────────────────────────────────

function main() {
  const readmePath = join(ROOT, "README.md");
  let readme = readFileSync(readmePath, "utf-8");

  // Build new project structure block
  const trees = ["src", "docs", "k8s"]
    .map(generateDirTree)
    .filter(Boolean)
    .join("\n\n");

  const newStructure = `## Project Structure\n\n\`\`\`\n${trees}\n\`\`\``;

  // Replace existing Project Structure section (from heading to next ## or EOF)
  const structureRegex = /## Project Structure\n[\s\S]*?(?=\n## |\n$)/;
  if (structureRegex.test(readme)) {
    readme = readme.replace(structureRegex, newStructure);
    writeFileSync(readmePath, readme, "utf-8");
    console.log("✅ README.md Project Structure section updated.");
  } else {
    console.log("⚠️  Could not find Project Structure section in README.md — skipping.");
  }
}

main();
