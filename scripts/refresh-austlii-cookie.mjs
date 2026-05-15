#!/usr/bin/env node
/**
 * Refresh AUSTLII_COOKIE in .env by decrypting the cookies Chrome already
 * holds for .austlii.edu.au. macOS only.
 *
 * No browser interaction needed — Chrome silently passes Cloudflare's challenge
 * with its normal browser fingerprint, so the cookies are already in Chrome's
 * cookie store; we just decrypt them and write to .env.
 *
 * Decryption logic lives in scripts/lib/decrypt-chrome-cookies.mjs and is
 * shared with scripts/austlii-cookie-bridge.mjs.
 *
 * Exit codes:
 *   0  success
 *   1  cookies missing in Chrome's DB (visit AustLII first)
 *   2  Keychain access denied
 *   3  decryption failed (probably a Chrome format change)
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decryptAustliiCookies, DecryptError } from "./lib/decrypt-chrome-cookies.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_ROOT = path.dirname(HERE);

// Resolve all project roots that need the same .env. With git worktrees, the
// MCP server may be spawned from any of the main repo or any worktree — they
// all need the cookie. We enumerate every checkout via `git worktree list`.
const PROJECT_ROOTS = (() => {
  const roots = new Set([SCRIPT_ROOT]);
  try {
    const out = execFileSync(
      "git",
      ["-C", SCRIPT_ROOT, "worktree", "list", "--porcelain"],
      { encoding: "utf8" },
    );
    for (const line of out.split("\n")) {
      if (line.startsWith("worktree ")) {
        roots.add(line.slice("worktree ".length));
      }
    }
  } catch {
    // not a git checkout — fall through, write to SCRIPT_ROOT only
  }
  return [...roots];
})();

function step(msg) {
  console.error(`[refresh] ${msg}`);
}

function exitForCode(code) {
  switch (code) {
    case "keychain_denied":
      return 2;
    case "cookies_missing":
      return 1;
    case "decrypt_failed":
      return 3;
    default:
      return 4;
  }
}

function main() {
  step("decrypting AustLII cookies from Chrome's cookie store");
  let result;
  try {
    result = decryptAustliiCookies();
  } catch (err) {
    if (err instanceof DecryptError) {
      console.error(`[refresh] ${err.code}: ${err.message}`);
      process.exit(exitForCode(err.code));
    }
    console.error(`[refresh] unexpected error: ${err instanceof Error ? err.message : err}`);
    process.exit(4);
  }
  step(`cf_clearance: ${result.cf_clearance.length} chars`);
  step(`__cf_bm:      ${result.__cf_bm.length} chars`);

  for (const root of PROJECT_ROOTS) {
    const envPath = path.join(root, ".env");
    const env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
    let next;
    if (/^AUSTLII_COOKIE=.*/m.test(env)) {
      next = env.replace(/^AUSTLII_COOKIE=.*/m, `AUSTLII_COOKIE="${result.cookie}"`);
    } else {
      next =
        env +
        (env.endsWith("\n") || env === "" ? "" : "\n") +
        `AUSTLII_COOKIE="${result.cookie}"\n`;
    }
    writeFileSync(envPath, next);
    step(`wrote ${envPath}`);
  }
  console.log(
    `OK refreshed cf_clearance(${result.cf_clearance.length}) __cf_bm(${result.__cf_bm.length}) -> ${PROJECT_ROOTS.length} .env file(s)`,
  );
}

main();
