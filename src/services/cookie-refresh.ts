/**
 * Self-healing AUSTLII_COOKIE refresh.
 *
 * On AustLII 401/403, run scripts/refresh-austlii-cookie.mjs to decrypt
 * whatever cookies the user's Chrome currently has cached for `.austlii.edu.au`
 * and write them to `.env`. Reload `.env` into `process.env` so the new
 * cookie takes effect immediately and retry the failing request.
 *
 * Works whenever Chrome's stored cookies are fresher than the server's
 * `.env` — the common case, since Chrome rotates cookies in the background
 * as the user browses.
 *
 * If Chrome's stored cookies are also stale (or Cloudflare has flagged the
 * machine's IP and isn't accepting our cookies even when fresh), the retry
 * also 401/403s and we throw {@link AustliiPersistentAuthError}. Recovery
 * is then a manual step: the user opens AustLII in Chrome and runs a search
 * (Cloudflare's challenge fires reliably from a real form submission, less
 * reliably from direct URL navigation). On the next tool call, the server
 * extracts the freshly-issued cookies from Chrome's DB and proceeds normally.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { parse as parseEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
// dist/services/cookie-refresh.js → dist/services → dist → project root
const PROJECT_ROOT = path.dirname(path.dirname(HERE));
const SCRIPT_PATH = path.join(PROJECT_ROOT, "scripts", "refresh-austlii-cookie.mjs");
const ENV_PATH = path.join(PROJECT_ROOT, ".env");

// Coalesce concurrent refresh requests — many tool calls may all 403 at once
// during expiry, but we only want to run the script once. Note: deliberately
// no time-based throttle. The script is fast (~1s) and idempotent; if the
// user has just submitted a search in Chrome to refresh cookies, we want the
// next 403 to run the script again immediately, not be silently throttled.
let refreshInFlight: Promise<boolean> | null = null;

/**
 * Run the script to decrypt+write the cookies Chrome currently holds, and
 * reload .env into process.env.
 *
 * @returns `true` if the script ran successfully and process.env was updated;
 *          `false` if the script is missing, exited non-zero, threw, or
 *          .env became unparsable.
 */
export async function tryRefreshAustliiCookie(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = doRefresh();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function doRefresh(): Promise<boolean> {
  if (!existsSync(SCRIPT_PATH)) {
    return false;
  }
  try {
    await execFileAsync("node", [SCRIPT_PATH], {
      timeout: 15_000,
      env: process.env,
    });
  } catch {
    return false;
  }
  if (existsSync(ENV_PATH)) {
    try {
      const parsed = parseEnv(readFileSync(ENV_PATH, "utf8"));
      for (const [key, value] of Object.entries(parsed)) {
        process.env[key] = value;
      }
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Marker error: an AustLII 401/403 that *persisted* through a successful
 * cookie refresh and a retry. Caller should surface guidance instructing
 * the user to open AustLII in Chrome and run a search.
 */
export class AustliiPersistentAuthError extends Error {
  constructor(public readonly status: number) {
    super(`AustLII persistent ${status} after cookie refresh`);
    this.name = "AustliiPersistentAuthError";
  }
}

/**
 * Wraps an async operation (typically an axios call) so AustLII 401/403
 * responses transparently trigger a refresh-and-retry.
 *
 * Terminal states:
 *  1. Initial call succeeds → returns its result.
 *  2. 401/403 → refresh succeeds → retry succeeds → returns retry result.
 *  3. 401/403 → refresh succeeds → retry still 401/403 → throws
 *     {@link AustliiPersistentAuthError}.
 *  4. 401/403 → refresh did NOT run (script missing, throttled, keychain
 *     denied) → original axios error propagates.
 *  5. Non-Cloudflare errors propagate as-is, no refresh attempted.
 */
export async function withCookieRefreshRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isAustliiAuthError(err)) throw err;
    const refreshed = await tryRefreshAustliiCookie();
    if (!refreshed) throw err;
    try {
      return await fn();
    } catch (retryErr) {
      if (isAustliiAuthError(retryErr)) {
        throw new AustliiPersistentAuthError(extractStatus(retryErr));
      }
      throw retryErr;
    }
  }
}

function isAustliiAuthError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { response?: { status?: number }; isAxiosError?: boolean };
  if (e.isAxiosError !== true) return false;
  return e.response?.status === 401 || e.response?.status === 403;
}

function extractStatus(err: unknown): number {
  return (err as { response?: { status?: number } }).response?.status ?? 403;
}
