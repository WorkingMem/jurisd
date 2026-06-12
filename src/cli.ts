/**
 * Thin CLI subcommand dispatch (WS-E §5.1).
 *
 * The entry point branches on `process.argv` before the server starts. No
 * heavyweight CLI framework — a thin switch over the first positional arg:
 *
 *   jurisd fetch-module <name> [--version X.Y.Z] [--manifest-url URL] [--modules-dir DIR]
 *   jurisd verify-module <name> [--modules-dir DIR]
 *   jurisd list-modules [--modules-dir DIR]
 *
 * Returns true when a subcommand was handled (and the process should exit), or
 * false when no subcommand was given and the server should start.
 */

import { fetchModule, verifyModule } from "./services/fetch-module.js";
import { listDataModules, setModulesRootForTest } from "./services/modules.js";

/** Parse `--flag value` and `--flag=value` pairs out of an argv tail. */
function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        flags[a.slice(2)] = args[i + 1] ?? "";
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

/**
 * Handle a CLI subcommand. Returns true when handled (process should exit with
 * `process.exitCode`), false when no subcommand was given.
 */
export async function runCli(argv: string[]): Promise<boolean> {
  const [command, ...rest] = argv;
  if (!command || command.startsWith("--")) return false;
  if (!["fetch-module", "verify-module", "list-modules"].includes(command)) return false;

  const { positional, flags } = parseFlags(rest);
  const modulesDir = flags["modules-dir"];

  // Point the loader at an explicit modules dir when given (CLI override).
  if (modulesDir) setModulesRootForTest(modulesDir, true);

  if (command === "fetch-module") {
    const name = positional[0];
    if (!name) {
      console.error("usage: jurisd fetch-module <name> [--version X.Y.Z] [--manifest-url URL]");
      process.exitCode = 2;
      return true;
    }
    const result = await fetchModule(name, {
      manifestUrl: flags["manifest-url"],
      modulesDir,
    });
    if (result.ok) {
      console.error(`installed module '${name}' to ${result.installedPath}`);
      if (result.attribution?.length) {
        console.error("Licence attribution (redistribution terms):");
        for (const line of result.attribution) console.error(`  ${line}`);
      }
      process.exitCode = 0;
    } else {
      console.error(`fetch-module failed: ${result.error}`);
      process.exitCode = 1;
    }
    return true;
  }

  if (command === "verify-module") {
    const name = positional[0];
    if (!name) {
      console.error("usage: jurisd verify-module <name> [--modules-dir DIR]");
      process.exitCode = 2;
      return true;
    }
    const result = verifyModule(name, { modulesDir });
    if (result.ok) {
      console.error(`module '${name}' verified OK (${result.installedPath})`);
      process.exitCode = 0;
    } else {
      console.error(`verify-module failed: ${result.error}`);
      process.exitCode = 1;
    }
    return true;
  }

  // list-modules
  const modules = listDataModules({ refresh: true, includeInvalid: true });
  console.error(JSON.stringify({ count: modules.length, modules }, null, 2));
  process.exitCode = 0;
  return true;
}
