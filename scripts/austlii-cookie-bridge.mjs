#!/usr/bin/env node
/**
 * AustLII Cookie Bridge — a tiny long-running HTTP service that decrypts
 * Chrome's AustLII cookies on demand and serves them over localhost.
 *
 * WHY this exists:
 *
 *   The auslaw-mcp server's normal cookie refresh decrypts Chrome's SQLite
 *   cookie store directly. That requires the server process to have:
 *     - read access to ~/Library/Application Support/Google/Chrome/...
 *     - permission to call macOS Keychain (`security find-generic-password`)
 *
 *   In some setups — notably Claude Cowork sessions — the MCP server runs in
 *   a sandbox that denies one or both. The script can't decrypt, the cookie
 *   never refreshes, every AustLII request 403s.
 *
 *   This bridge runs OUTSIDE the sandbox, on the user's normal host, with
 *   full filesystem + Keychain access. The sandboxed MCP server queries the
 *   bridge over localhost HTTP and applies whatever cookie the bridge returns.
 *   The sandbox boundary stops mattering because all the sensitive work
 *   happens host-side.
 *
 * USAGE:
 *
 *   # Start it (foreground, ^C to stop):
 *   node scripts/austlii-cookie-bridge.mjs
 *
 *   # Or in the background:
 *   node scripts/austlii-cookie-bridge.mjs &
 *
 *   # Tell auslaw-mcp where to find it (in .env or .mcp.json env block):
 *   AUSTLII_COOKIE_BRIDGE_URL=http://127.0.0.1:8765
 *
 *   # Optional: pick a different port
 *   AUSTLII_COOKIE_BRIDGE_PORT=9876 node scripts/austlii-cookie-bridge.mjs
 *
 * ENDPOINTS:
 *
 *   GET /healthz   200 "ok"
 *   GET /cookie    200 {"cookie":"cf_clearance=...; __cf_bm=...","ts":1234567890}
 *                  500 {"error":"...","code":"..."} on decryption failure
 *
 *   Both endpoints bind to 127.0.0.1 only — they cannot be reached from
 *   the network.
 */

import http from "node:http";
import { decryptAustliiCookies, DecryptError } from "./lib/decrypt-chrome-cookies.mjs";

const PORT = parseInt(process.env.AUSTLII_COOKIE_BRIDGE_PORT || "8765", 10);
const HOST = "127.0.0.1";

function log(msg) {
  console.error(`[austlii-cookie-bridge] ${new Date().toISOString()} ${msg}`);
}

function handleCookieRequest(_req, res) {
  try {
    const result = decryptAustliiCookies();
    const body = JSON.stringify({
      cookie: result.cookie,
      cf_clearance_length: result.cf_clearance.length,
      __cf_bm_length: result.__cf_bm.length,
      ts: Date.now(),
    });
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(body);
    log(
      `OK /cookie → cf_clearance(${result.cf_clearance.length}) __cf_bm(${result.__cf_bm.length})`,
    );
  } catch (err) {
    const code = err instanceof DecryptError ? err.code : "unknown_error";
    const message = err instanceof Error ? err.message : String(err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message, code }));
    log(`ERROR /cookie → ${code}: ${message}`);
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  if (req.method === "GET" && req.url === "/cookie") {
    handleCookieRequest(req, res);
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

server.on("error", (err) => {
  log(`fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  log(`listening on http://${HOST}:${PORT}`);
  log(`set AUSTLII_COOKIE_BRIDGE_URL=http://${HOST}:${PORT} in auslaw-mcp's env`);
});

// Graceful shutdown
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    log(`${sig} received, shutting down`);
    server.close(() => process.exit(0));
  });
}
