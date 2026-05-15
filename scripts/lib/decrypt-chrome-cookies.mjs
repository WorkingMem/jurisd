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

// Cloudflare sets three cookies on AustLII traffic:
//   cf_clearance  — proves the browser passed the JS challenge (1hr+ lifetime)
//   __cf_bm       — bot management session token (~30min)
//   __cflb        — load-balancer affinity. WITHOUT IT, requests sometimes hit
//                   a backend that doesn't recognise the cf_clearance and 403s.
//                   This is the cookie the user discovered missing on
//                   2026-05-15 — diagnosed by curling AustLII with cf_clearance
//                   + __cf_bm only and still getting 403, then noticing __cflb
//                   in Chrome's DB.
//
// __cflb is set for `www.austlii.edu.au` (without the leading dot) while
// the others are set for `.austlii.edu.au`. Hence the SQL filters both.
const COOKIE_SPECS = [
  { name: "cf_clearance", host: ".austlii.edu.au" },
  { name: "__cf_bm", host: ".austlii.edu.au" },
  { name: "__cflb", host: "www.austlii.edu.au" },
];
// The host used for the SHA-256 integrity prefix check is the per-cookie
// host_key as stored by Chrome, so the prefix stripping must use the
// matching host for each cookie.

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
  // Pull all three cookies in one query. The WHERE clause matches each
  // (name, host_key) pair the spec lists.
  const whereClauses = COOKIE_SPECS.map(
    (c) => `(name='${c.name}' AND host_key='${c.host}')`,
  ).join(" OR ");
  const sql = `SELECT name, host_key, hex(encrypted_value) FROM cookies WHERE ${whereClauses};`;
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
    const [name, hostKey, hex] = line.split("|");
    rows[name] = { hostKey, bytes: Buffer.from(hex, "hex") };
  }
  // cf_clearance + __cf_bm are required. __cflb is strongly recommended (the
  // load balancer cookie) but may not always be set — Cloudflare only writes
  // it when load balancing is active. Don't fail if it's missing, but warn.
  for (const c of COOKIE_SPECS) {
    if (!rows[c.name] && c.name !== "__cflb") {
      throw new DecryptError(
        `Cookie ${c.name} not found in Chrome's DB for ${c.host}. ` +
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

function stripIntegrityPrefix(plain, hostKey) {
  if (plain.length < 32) return plain;
  const expected = createHash("sha256").update(hostKey).digest();
  if (plain.slice(0, 32).equals(expected)) {
    return plain.slice(32);
  }
  return plain;
}

/**
 * Decrypt the user's Chrome cookies for AustLII.
 *
 * Returns the Cookie header value (e.g. `cf_clearance=...; __cf_bm=...; __cflb=...`)
 * plus the individual values per-name. `__cflb` may be undefined if
 * Cloudflare hasn't issued it for this session; in that case the Cookie
 * header just contains the two required cookies.
 *
 * @returns {{ cookie: string, cf_clearance: string, __cf_bm: string, __cflb?: string }}
 * @throws {DecryptError} on keychain, sqlite, or decryption failure.
 */
export function decryptAustliiCookies() {
  const safeStorageKey = readChromeSafeStorageKey();
  const aesKey = deriveAesKey(safeStorageKey);
  const encrypted = readEncryptedCookies();
  const decrypted = {};
  for (const c of COOKIE_SPECS) {
    const row = encrypted[c.name];
    if (!row) continue; // optional cookie missing — checked above for required ones
    try {
      const plain = decryptBlob(row.bytes, aesKey);
      decrypted[c.name] = stripIntegrityPrefix(plain, row.hostKey).toString("utf8");
    } catch (err) {
      if (err instanceof DecryptError) throw err;
      throw new DecryptError(
        `Failed to decrypt ${c.name}: ${err.message}`,
        "decrypt_failed",
      );
    }
  }
  // Build cookie string in spec order, skipping missing optional cookies.
  const cookieStr = COOKIE_SPECS.filter((c) => decrypted[c.name])
    .map((c) => `${c.name}=${decrypted[c.name]}`)
    .join("; ");
  return {
    cookie: cookieStr,
    cf_clearance: decrypted.cf_clearance,
    __cf_bm: decrypted.__cf_bm,
    __cflb: decrypted.__cflb,
  };
}
