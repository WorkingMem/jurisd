/**
 * Thin CLI subcommand dispatch.
 *
 * The entry point branches on `process.argv` before the server starts. No
 * heavyweight CLI framework — a thin switch over the first positional arg.
 *
 * Two families of subcommand exist:
 *
 *   Module management (run directly, before the server):
 *     jurisd fetch-module <name> [--version X.Y.Z] [--manifest-url URL] [--modules-dir DIR]
 *     jurisd verify-module <name> [--modules-dir DIR]
 *     jurisd list-modules [--modules-dir DIR]
 *
 *   MCP-tool parity (routed through an in-process loopback to the SAME handlers
 *   any MCP client would hit, so the CLI cannot drift from the protocol):
 *     jurisd search-cases <query> [--jurisdiction nsw] [--limit 10] ...
 *     jurisd get-provision <act> <provision> ...
 *     jurisd format-citation <title> --neutral-citation '[1992] HCA 23' ...
 *     ... one subcommand per registered tool.
 *
 * `runCli` returns true when a subcommand was handled (and the process should
 * exit via `process.exitCode`), or false when no subcommand was given and the
 * server should start.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { getCommandContractByCliName } from "./commands/contracts.js";
import { renderCommandHelp, renderCommandList, renderTopLevelHelp } from "./commands/help.js";
import { contractToToolCommand, type ToolCommand } from "./commands/legacy-cli.js";
import { createMcpServer } from "./server.js";
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

/** Convert a kebab-case flag name to the camelCase schema field it targets. */
function flagToField(flag: string): string {
  return flag.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * `semantic_search_local` accepts a nested `filter` object. Flags of the form
 * `--filter-<facet>` are folded into that object so the CLI can express it
 * without bespoke parsing per facet.
 */
function applyFilterFlag(args: Record<string, unknown>, field: string, value: string): void {
  const facet = field.slice("filter".length);
  const key = facet.charAt(0).toLowerCase() + facet.slice(1);
  const filter = (args.filter as Record<string, unknown> | undefined) ?? {};
  filter[key] = value;
  args.filter = filter;
}

/**
 * Pure mapping from parsed argv to a tool `arguments` object. Positional values
 * fill the command's positional fields in order; flags fill the remaining
 * fields with type coercion. Kept side-effect free so it is unit-testable
 * without a live loopback.
 */
export function mapArgvToToolInput(
  command: ToolCommand,
  positional: string[],
  flags: Record<string, string>,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};

  command.positional.forEach((field, i) => {
    const value = positional[i];
    if (value !== undefined) args[field] = value;
  });

  for (const [flag, raw] of Object.entries(flags)) {
    if (flag === "modules-dir") continue;
    const field = flagToField(flag);
    if (field.startsWith("filter") && field.length > "filter".length) {
      applyFilterFlag(args, field, raw);
    } else if (command.numeric.includes(field)) {
      args[field] = Number(raw);
    } else if (command.boolean.includes(field)) {
      args[field] = raw === "" ? true : raw === "true";
    } else if (command.array.includes(field)) {
      args[field] = raw.split(",").map((s) => s.trim());
    } else {
      args[field] = raw;
    }
  }

  return args;
}

/** Run a tool through the in-process loopback and stream its result to stdout. */
async function runToolCommand(
  command: ToolCommand,
  positional: string[],
  flags: Record<string, string>,
): Promise<void> {
  const args = mapArgvToToolInput(command, positional, flags);

  const server = createMcpServer();
  const client = new Client({ name: "jurisd-cli", version: "0.1.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const result = await client.callTool({ name: command.tool, arguments: args });
    const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
    for (const block of content) {
      if (block.type === "text" && block.text !== undefined) {
        process.stdout.write(block.text + "\n");
      }
    }
    process.exitCode = result.isError ? 1 : 0;
  } finally {
    // Settle both teardowns independently so a failing client close cannot
    // skip the server close (or mask an earlier error) on any transport.
    await Promise.allSettled([client.close(), server.close()]);
  }
}

/** One-line usage banner listing every available subcommand. */
function printHelp(): void {
  console.error(renderTopLevelHelp());
}

/**
 * Handle a CLI subcommand. Returns true when handled (process should exit with
 * `process.exitCode`), false when no subcommand was given.
 */
export async function runCli(argv: string[]): Promise<boolean> {
  const [command, ...rest] = argv;
  if (!command || command.startsWith("--")) {
    if (command === "--help") {
      printHelp();
      process.exitCode = 0;
      return true;
    }
    return false;
  }

  if (command === "help") {
    const topic = rest[0];
    if (!topic) {
      console.error(renderTopLevelHelp());
      process.exitCode = 0;
    } else if (topic === "commands") {
      console.error(renderCommandList());
      process.exitCode = 0;
    } else {
      const contract = getCommandContractByCliName(topic);
      console.error(contract ? renderCommandHelp(contract) : `unknown help topic: ${topic}`);
      process.exitCode = contract ? 0 : 2;
    }
    return true;
  }

  const contract = getCommandContractByCliName(command);
  if (contract && (rest.includes("--help") || rest.includes("-h"))) {
    console.error(renderCommandHelp(contract));
    process.exitCode = 0;
    return true;
  }

  const toolCommand = contract?.adapters.mcp.enabled ? contractToToolCommand(contract) : undefined;
  if (toolCommand) {
    const { positional, flags } = parseFlags(rest);
    if (flags["modules-dir"]) setModulesRootForTest(flags["modules-dir"], true);
    if (positional.length < toolCommand.positional.length) {
      const fields = toolCommand.positional.map((f) => `<${f}>`).join(" ");
      console.error(`usage: jurisd ${command} ${fields} [--flag value ...]`);
      process.exitCode = 2;
      return true;
    }
    await runToolCommand(toolCommand, positional, flags);
    return true;
  }

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
