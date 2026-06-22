import { COMMAND_CONTRACTS } from "./contracts.js";
import type { CommandContract } from "./types.js";

const GROUPS = [
  ["search", "Search cases, legislation, citations, and local modules"],
  ["cite", "Resolve, format, cache, and list citations"],
  ["corpus", "Inspect installed local data modules and future corpora"],
  ["graph", "Inspect local relationship data and future graph traces"],
  ["source", "Fetch or inspect source documents"],
  ["mcp", "Run and inspect MCP integration"],
  ["doctor", "Diagnose configuration and capabilities"],
  ["tui", "Open the inline terminal workbench shell"],
] as const;

export function renderTopLevelHelp(): string {
  const lines = [
    "jurisd - source-backed Australian legal research",
    "",
    "Usage:",
    "  jurisd <command> [arguments] [flags]",
    "  jurisd help <topic>",
    "  jurisd completion <shell>",
    "  jurisd tui",
    "  jurisd mcp serve",
    "",
    "Common groups:",
    ...GROUPS.map(([name, summary]) => `  ${name.padEnd(10)} ${summary}`),
    "",
    "Compatibility aliases:",
    "  Existing flat commands such as search-cases and format-citation remain available.",
    "",
    "Run `jurisd help <topic>` or `jurisd <command> --help` for details.",
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
