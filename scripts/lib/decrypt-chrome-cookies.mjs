/**
 * Shared library for decrypting Chrome's AustLII cookies on macOS.
 *
 * Two consumers:
 *  - scripts/refresh-austlii-cookie.mjs  (one-shot writer to .env files)
 *  - scripts/austlii-cookie-bridge.mjs   (long-running HTTP service for
 *                                         sandboxed MCP server use)
 *
 * Pipeline:
 *  1. `security find-generic-password -wa Chrome` → Chrome's safe-storage AES key
 *  2. PBKDF2-HMAC-SHA1 → 16-byte AES-128 key
 *  3. Read encrypted_value blobs from Chrome's Cookies SQLite DB
 *  4. AES-128-CBC decrypt with 16-byte IV of 0x20; strip "v10"/"v11" prefix
 *     and Chrome ≥130's SHA-256(host) integrity prefix
 *
 * Throws DecryptError on failure with a `code` property the CLI can map to
 * its exit codes.
 */

import { execFileSync } from "node:child_process";
import { pbkdf2Sync, createDecipheriv, createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";

const HOST = ".austlii.edu.au";
const NAMES = ["cf_clearance", "__cf_bm"];

const COOKIE_DB = path.join(
  os.homedir(),
  "Library/Application Support/Google/Chrome/Default/Cookies",
);

export class DecryptError extends Error {
  /**
   * @param {string} message
   * @param {"keychain_denied" | "cookies_missing" | "decrypt_failed"} code
   */
  constructor(message, code) {
    super(message);
    this.name = "DecryptError";
    this.code = code;
  }
}

function readChromeSafeStorageKey() {
  try {
    return execFileSync("security", ["find-generic-password", "-wa", "Chrome"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new DecryptError(
      "Keychain access for Chrome Safe Storage was denied or unavailable. " +
        "Run `security find-generic-password -wa Chrome` manually and click " +
        '"Always Allow" the first time, or pre-approve the Access Control entry ' +
        "in Keychain Access.app.",
      "keychain_denied",
    );
  }
}

function deriveAesKey(safeStorageKey) {
  return pbkdf2Sync(safeStorageKey, "saltysalt", 1003, 16, "sha1");
}

function readEncryptedCookies() {
  const placeholders = NAMES.map((n) => `'${n}'`).join(",");
  const sql = `SELECT name, hex(encrypted_value) FROM cookies WHERE host_key='${HOST}' AND name IN (${placeholders});`;
  let out;
  try {
    out = execFileSync("sqlite3", [COOKIE_DB, sql], { encoding: "utf8" });
  } catch (err) {
    throw new DecryptError(
      `Could not read Chrome's cookie DB at ${COOKIE_DB}: ${err.message}`,
      "cookies_missing",
    );
  }
  const rows = {};
  for (const line of out.trim().split("\n")) {
    if (!line) continue;
    const [name, hex] = line.split("|");
    rows[name] = Buffer.from(hex, "hex");
  }
  for (const n of NAMES) {
    if (!rows[n]) {
      throw new DecryptError(
        `Cookie ${n} not found in Chrome's DB for ${HOST}. ` +
          "Visit https://www.austlii.edu.au/ in Chrome first.",
        "cookies_missing",
      );
    }
  }
  return rows;
}

function decryptBlob(encrypted, aesKey) {
  const prefix = encrypted.slice(0, 3).toString("ascii");
  if (prefix !== "v10" && prefix !== "v11") {
    throw new DecryptError(
      `Unknown Chrome encryption prefix: ${JSON.stringify(prefix)}`,
      "decrypt_failed",
    );
  }
  const ciphertext = encrypted.slice(3);
  const iv = Buffer.alloc(16, 0x20);
  const decipher = createDecipheriv("aes-128-cbc", aesKey, iv);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function stripIntegrityPrefix(plain) {
  if (plain.length < 32) return plain;
  const expected = createHash("sha256").update(HOST).digest();
  if (plain.slice(0, 32).equals(expected)) {
    return plain.slice(32);
  }
  return plain;
}

/**
 * Decrypt the user's Chrome cookies for AustLII.
 *
 * @returns {{ cookie: string, cf_clearance: string, __cf_bm: string }}
 *   `cookie` is the formatted Cookie header value
 *   `cf_clearance` and `__cf_bm` are the individual values.
 * @throws {DecryptError} on keychain, sqlite, or decryption failure.
 */
export function decryptAustliiCookies() {
  const safeStorageKey = readChromeSafeStorageKey();
  const aesKey = deriveAesKey(safeStorageKey);
  const encrypted = readEncryptedCookies();
  const decrypted = {};
  for (const name of NAMES) {
    try {
      const plain = decryptBlob(encrypted[name], aesKey);
      decrypted[name] = stripIntegrityPrefix(plain).toString("utf8");
    } catch (err) {
      if (err instanceof DecryptError) throw err;
      throw new DecryptError(
        `Failed to decrypt ${name}: ${err.message}`,
        "decrypt_failed",
      );
    }
  }
  return {
    cookie: NAMES.map((n) => `${n}=${decrypted[n]}`).join("; "),
    cf_clearance: decrypted.cf_clearance,
    __cf_bm: decrypted.__cf_bm,
  };
}
