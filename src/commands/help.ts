import { COMMAND_CONTRACTS } from "./contracts.js";
import type { CommandContract } from "./types.js";

// Preferred display order for command groups. Any group present on a contract
// but missing here is still shown (appended, sorted) so new groups can never
// silently vanish from `--help` — the drift that previously hid the `modules`
// group and advertised a non-existent `mcp` command.
const GROUP_ORDER = [
  "search",
  "cite",
  "corpus",
  "source",
  "graph",
  "modules",
  "doctor",
  "tui",
] as const;

function cliName(contract: CommandContract): string {
  return contract.adapters.cli.canonicalName ?? contract.id;
}

/** Group the CLI-enabled commands by their contract `cli.group`. */
function groupedCommands(): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const contract of COMMAND_CONTRACTS) {
    if (!contract.adapters.cli.enabled) continue;
    const group = contract.adapters.cli.group || "other";
    const names = groups.get(group) ?? [];
    names.push(cliName(contract));
    groups.set(group, names);
  }
  for (const names of groups.values()) names.sort();
  return groups;
}

export function renderTopLevelHelp(): string {
  const groups = groupedCommands();
  const orderedNames = [
    ...GROUP_ORDER.filter((name) => groups.has(name)),
    ...[...groups.keys()].filter((name) => !GROUP_ORDER.includes(name as never)).sort(),
  ];
  const width = Math.max(...orderedNames.map((name) => name.length));

  const lines = [
    "jurisd - source-backed Australian legal research",
    "",
    "Usage:",
    "  jurisd <command> [arguments] [flags]",
    "  jurisd help <command>",
    "  jurisd completion <bash|zsh|fish>",
    "  jurisd                  (no command: serve the MCP server on stdio)",
    "",
    "Commands:",
    ...orderedNames.map((name) => `  ${name.padEnd(width)}  ${groups.get(name)!.join(", ")}`),
    "",
    "Run `jurisd help <command>` or `jurisd <command> --help` for details.",
  ];
  return lines.join("\n");
}

export function renderCommandHelp(contract: CommandContract): string {
  const cli = contract.adapters.cli;
  const flagLines = contract.flags.length
    ? contract.flags.map((flag) => `  --${flag.name.padEnd(18)} ${flag.summary}`)
    : ["  (none)"];
  const argLines = contract.arguments.length
    ? contract.arguments.map((arg) => `  ${arg.name.padEnd(20)} ${arg.summary}`)
    : ["  (none)"];
  const exampleLines = contract.examples.length
    ? contract.examples.map((example) => `  ${example}`)
    : ["  (none)"];

  return [
    contract.summary,
    "",
    "Usage:",
    `  ${contract.synopsis}`,
    "",
    "Arguments:",
    ...argLines,
    "",
    "Flags:",
    ...flagLines,
    "",
    "Examples:",
    ...exampleLines,
    "",
    "Metadata:",
    `  command id: ${contract.id}`,
    `  side effect: ${contract.sideEffectClass}`,
    `  result: ${contract.resultContract}`,
    cli.aliases.length ? `  aliases: ${cli.aliases.join(", ")}` : "  aliases: (none)",
  ].join("\n");
}

export function renderCommandList(): string {
  return COMMAND_CONTRACTS.filter((contract) => contract.adapters.cli.enabled)
    .map((contract) => `${contract.adapters.cli.canonicalName ?? contract.id}: ${contract.summary}`)
    .sort()
    .join("\n");
}
