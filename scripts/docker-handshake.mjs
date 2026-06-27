#!/usr/bin/env node
// Stdio MCP handshake smoke test.
//
// Spawns a command (default: the jurisd container's `node dist/index.js`),
// drives the JSON-RPC `initialize` + `tools/list` exchange over stdin/stdout,
// and asserts the expected tool count. Exits non-zero on any mismatch so it can
// gate CI / a release.
//
// Usage:
//   node scripts/docker-handshake.mjs --engine podman --image jurisd:latest
//   node scripts/docker-handshake.mjs -- node dist/index.js   # run host build
//
// Env:
//   EXPECT_TOOLS  expected tool count (default 15)

import { spawn } from "node:child_process";

const EXPECT_TOOLS = Number(process.env.EXPECT_TOOLS ?? "15");

// Parse a tiny arg set: everything after `--` is the literal command to run;
// otherwise build a `<engine> run -i --rm <image>` invocation.
const argv = process.argv.slice(2);
let cmd;
const sep = argv.indexOf("--");
if (sep !== -1) {
  const rest = argv.slice(sep + 1);
  cmd = { bin: rest[0], args: rest.slice(1) };
} else {
  const get = (flag, def) => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : def;
  };
  const engine = get("--engine", "docker");
  const image = get("--image", "jurisd:latest");
  cmd = { bin: engine, args: ["run", "-i", "--rm", image] };
}

const child = spawn(cmd.bin, cmd.args, { stdio: ["pipe", "pipe", "pipe"] });

let stdout = "";
let stderr = "";
child.stdout.on("data", (d) => (stdout += d.toString()));
child.stderr.on("data", (d) => (stderr += d.toString()));

const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");

// Minimal MCP client side of the handshake.
send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "docker-handshake", version: "0.0.0" },
  },
});
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

// Give the server time to boot (capability probe) + answer, then read.
const deadline = setTimeout(() => {
  finish();
}, 20000);

function parseFrames(buf) {
  return buf
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function finish() {
  clearTimeout(deadline);
  try {
    child.stdin.end();
  } catch {}
  try {
    child.kill("SIGTERM");
  } catch {}

  const frames = parseFrames(stdout);
  const initRes = frames.find((f) => f.id === 1);
  const toolsRes = frames.find((f) => f.id === 2);

  if (!initRes?.result) {
    fail("no initialize result", { stdout, stderr });
  }
  const tools = toolsRes?.result?.tools;
  if (!Array.isArray(tools)) {
    fail("no tools array in tools/list result", { stdout, stderr });
  }

  const names = tools.map((t) => t.name).sort();
  console.log(`server: ${initRes.result.serverInfo?.name ?? "?"} v${initRes.result.serverInfo?.version ?? "?"}`);
  console.log(`tools (${names.length}): ${names.join(", ")}`);

  if (names.length !== EXPECT_TOOLS) {
    fail(`expected ${EXPECT_TOOLS} tools, got ${names.length}`, {});
  }
  console.log(`OK: ${names.length} tools listed`);
  process.exit(0);
}

function fail(msg, ctx) {
  console.error(`HANDSHAKE FAILED: ${msg}`);
  if (ctx.stdout) console.error("--- stdout ---\n" + ctx.stdout.slice(0, 2000));
  if (ctx.stderr) console.error("--- stderr ---\n" + ctx.stderr.slice(0, 2000));
  process.exit(1);
}

// Once we have both responses, finish early rather than waiting the full timeout.
const poll = setInterval(() => {
  const frames = parseFrames(stdout);
  if (frames.some((f) => f.id === 1) && frames.some((f) => f.id === 2)) {
    clearInterval(poll);
    finish();
  }
}, 250);

child.on("exit", (code) => {
  clearInterval(poll);
  if (stdout.includes('"id":2') || stdout.includes('"id": 2')) finish();
  else fail(`child exited (code ${code}) before tools/list reply`, { stdout, stderr });
});
