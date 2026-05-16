/**
 * Self-healing AUSTLII_COOKIE refresh. Two refresh paths, tried in order:
 *
 *   1. Bridge fetch (preferred for sandboxed MCP servers).
 *      If AUSTLII_COOKIE_BRIDGE_URL is set, GET {url}/cookie to receive a
 *      fresh cookie from a host-side service (scripts/austlii-cookie-bridge.mjs).
 *      This is the only path that works when the MCP server is sandboxed and
 *      can't access Chrome's cookie store directly.
 *
 *   2. Local script.
 *      Run scripts/refresh-austlii-cookie.mjs to decrypt cookies from Chrome's
 *      SQLite store. Requires filesystem + Keychain access — works when the
 *      MCP server is on the host but typically fails in Cowork sandboxes.
 *
 * On AustLII 401/403, the wrapper tries the refresh paths, updates
 * process.env, and retries once. Whenever Chrome's stored cookies are
 * fresher than the server's last view, the retry succeeds.
 *
 * If both refresh paths fail or the retried request still 401/403s, the
 * wrapper throws AustliiPersistentAuthError. Recovery: the user opens AustLII
 * in Chrome and runs a real search (the form-submission path consistently
 * triggers Cloudflare to issue fresh cookies). The next tool call's refresh
 * picks them up.
 *
 * For environments where the bridge isn't running and the script can't run,
 * callers can also explicitly apply a cookie via the refresh_austlii_cookie
 * MCP tool (paste mode) — see setAustliiCookieValue below.
 */

import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
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
 * Try the bridge HTTP service if AUSTLII_COOKIE_BRIDGE_URL is configured.
 * Returns true if a fresh cookie was retrieved and applied to process.env.
 */
async function tryRefreshViaBridge(): Promise<boolean> {
  const bridgeBase = process.env.AUSTLII_COOKIE_BRIDGE_URL?.trim().replace(/\/+$/, "");
  if (!bridgeBase) return false;
  try {
    const res = await fetch(`${bridgeBase}/cookie`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as {
      cookie?: string;
      userAgent?: string;
      error?: string;
    };
    if (!body.cookie) return false;
    process.env.AUSTLII_COOKIE = body.cookie;
    // The bridge also reports Chrome's currently-installed UA. Apply it so
    // we stay in sync when Chrome auto-updates (e.g. 147→148). cf_clearance
    // is bound to the UA Chrome was advertising when it was issued; if .env
    // has stale UA, Cloudflare invalidates the cookie even though we've just
    // pulled it fresh from Chrome's store.
    if (body.userAgent) {
      process.env.AUSTLII_USER_AGENT = body.userAgent;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Try the local refresh script. Requires the server to have filesystem +
 * Keychain access to Chrome — works on host installs, typically fails in
 * sandboxes.
 */
async function tryRefreshViaScript(): Promise<boolean> {
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
 * Refresh AUSTLII_COOKIE by trying the bridge first, then falling back to
 * the local script. Returns true if either path succeeded and process.env
 * was updated with a new cookie value.
 *
 * Concurrent callers share one in-flight refresh.
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
  if (await tryRefreshViaBridge()) return true;
  if (await tryRefreshViaScript()) return true;
  return false;
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

/**
 * Apply a cookie value the AI has obtained from any source — paste from
 * DevTools, output of a Bash-run refresh script, etc. Writes it to every
 * .env in scope (main repo + every worktree, discovered via
 * `git worktree list`) and updates `process.env` immediately so subsequent
 * requests pick up the new value with no server restart.
 *
 * Used by the `refresh_austlii_cookie` MCP tool. This is the fallback path
 * when the server's auto-refresh (which depends on the script having
 * filesystem + Keychain access) doesn't work — for example, when the MCP
 * server runs in a sandbox that can't read Chrome's cookie store.
 *
 * @param cookie  The full Cookie header value (e.g.
 *                `cf_clearance=...; __cf_bm=...`). Whitespace and surrounding
 *                quotes are trimmed.
 * @returns The list of .env file paths written.
 */
export function setAustliiCookieValue(cookie: string): string[] {
  const cleaned = cookie.trim().replace(/^["']|["']$/g, "");
  if (!cleaned) {
    throw new Error("Cookie value cannot be empty");
  }
  const roots = discoverProjectRoots();
  const written: string[] = [];
  for (const root of roots) {
    const envPath = path.join(root, ".env");
    const env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
    let next: string;
    if (/^AUSTLII_COOKIE=.*/m.test(env)) {
      next = env.replace(/^AUSTLII_COOKIE=.*/m, `AUSTLII_COOKIE="${cleaned}"`);
    } else {
      next = env + (env.endsWith("\n") || env === "" ? "" : "\n") + `AUSTLII_COOKIE="${cleaned}"\n`;
    }
    writeFileSync(envPath, next);
    written.push(envPath);
  }
  // Update in-memory env so the next request picks it up without a restart.
  process.env.AUSTLII_COOKIE = cleaned;
  return written;
}

/**
 * Re-parse the project's `.env` and update `process.env`. Used when an
 * external party (e.g. the AI running the refresh script via Bash) has
 * updated `.env` and wants the MCP server to pick up the new value
 * without restarting.
 *
 * @returns The path of the .env file that was loaded, or `null` if no
 *          .env was found.
 */
export function reloadEnv(): string | null {
  if (!existsSync(ENV_PATH)) return null;
  try {
    const parsed = parseEnv(readFileSync(ENV_PATH, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      process.env[key] = value;
    }
    return ENV_PATH;
  } catch {
    return null;
  }
}

function discoverProjectRoots(): string[] {
  const roots = new Set([PROJECT_ROOT]);
  try {
    const out = execFileSync("git", ["-C", PROJECT_ROOT, "worktree", "list", "--porcelain"], {
      encoding: "utf8",
    });
    for (const line of out.split("\n")) {
      if (line.startsWith("worktree ")) {
        roots.add(line.slice("worktree ".length));
      }
    }
  } catch {
    // not a git checkout (or git unavailable) — fall through, return main only
  }
  return [...roots];
}
