import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const PYTHON_PTY_RUNNER = String.raw`
import os
import pty
import select
import signal
import sys
import time

tsx_bin = sys.argv[1]
modules_dir = sys.argv[2]
env = os.environ.copy()
env["TERM"] = "dumb"
env["COLUMNS"] = "40"
env["JURISD_MODULES_DIR"] = modules_dir
cmd = [tsx_bin, "src/index.ts", "tui"]

pid, fd = pty.fork()
if pid == 0:
    os.execvpe(cmd[0], cmd, env)

output = b""
sent = False
status = 124
deadline = time.time() + 20

try:
    while True:
        ready, _, _ = select.select([fd], [], [], 0.1)
        if ready:
            try:
                data = os.read(fd, 4096)
            except OSError:
                data = b""
            if not data:
                done, raw_status = os.waitpid(pid, 0)
                status = os.waitstatus_to_exitcode(raw_status)
                break
            output += data
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()
            if (not sent) and b"jurisd>" in output:
                os.write(fd, b"/commands\r/corpus.listDataModules\r/quit\r")
                sent = True

        done, raw_status = os.waitpid(pid, os.WNOHANG)
        if done:
            status = os.waitstatus_to_exitcode(raw_status)
            break

        if time.time() > deadline:
            os.kill(pid, signal.SIGTERM)
            status = 124
            break
finally:
    try:
        os.close(fd)
    except OSError:
        pass

sys.exit(status)
`;

function findPythonWithPty(): string | undefined {
  for (const candidate of ["python3", "python"]) {
    const result = spawnSync(
      candidate,
      ["-c", "import os, pty; assert hasattr(os, 'waitstatus_to_exitcode')"],
      { stdio: "ignore" },
    );
    if (result.status === 0) return candidate;
  }
  return undefined;
}

const PYTHON_WITH_PTY = findPythonWithPty();
const PTY_SMOKE_SUPPORTED = process.platform !== "win32" && Boolean(PYTHON_WITH_PTY);

describe("jurisd tui pseudo-terminal smoke", () => {
  let modulesDir: string;

  beforeEach(() => {
    modulesDir = fs.mkdtempSync(path.join(os.tmpdir(), "jurisd-tui-smoke-"));
  });

  afterEach(() => {
    fs.rmSync(modulesDir, { recursive: true, force: true });
  });

  it.skipIf(!PTY_SMOKE_SUPPORTED)(
    "runs under TERM=dumb, accepts a slash command, and exits cleanly",
    async () => {
      const tsxBin = path.join(process.cwd(), "node_modules", ".bin", "tsx");
      const python = PYTHON_WITH_PTY!;
      const child = spawn(python, ["-c", PYTHON_PTY_RUNNER, tsxBin, modulesDir], {
        cwd: process.cwd(),
        env: { ...process.env, TERM: "dumb", COLUMNS: "40", JURISD_MODULES_DIR: modulesDir },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        output += chunk.toString();
      });

      const code = await new Promise<number | null>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
      });

      expect(output).toContain("jurisd>");
      expect(code).toBe(0);
      expect(output).toContain("jurisd TUI scaffold");
      expect(output).toContain("width 40");
      expect(output).toContain("Command palette");
      expect(output).toContain("dispatch: corpus.listDataModules");
      expect(output).toContain('"count"');
      expect(output).toContain("goodbye");
    },
  );
});
