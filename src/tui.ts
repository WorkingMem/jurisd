import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

import { mapArgvToToolInput, parseFlags } from "./commands/argv.js";
import { isUnsafeTerminalCode } from "./commands/completions.js";
import { COMMAND_CONTRACTS, getCommandContractByCliName } from "./commands/contracts.js";
import { renderCommandHelp } from "./commands/help.js";
import { contractToToolCommand, type ToolCommand } from "./commands/legacy-cli.js";
import { executeToolCommand, type ToolExecutionResult } from "./commands/tool-loopback.js";
import type { CommandContract } from "./commands/types.js";

const TUI_LOCAL_READ_COMMAND_IDS = new Set([
  "cite.format",
  "corpus.getActStructure",
  "corpus.getProvision",
  "corpus.listDataModules",
  "graph.findCiting",
  "search.semanticLocal",
]);

const TUI_ACCEPTED_WEB_READ_COMMAND_IDS = new Set(["search.cases", "search.legislation"]);

const TUI_ALLOWED_COMMAND_IDS = new Set([
  ...TUI_LOCAL_READ_COMMAND_IDS,
  ...TUI_ACCEPTED_WEB_READ_COMMAND_IDS,
]);

const TUI_CONFIRM_NETWORK_READ_FIELD = "confirmNetworkRead";
const TUI_CONFIRM_NETWORK_READ_FLAG = "confirm-network-read";

export interface TuiIO {
  input: Readable;
  output: Writable;
  columns?: number;
  executor?: TuiCommandExecutor;
}

export type TuiCommandExecutor = (
  command: ToolCommand,
  args: Record<string, unknown>,
) => Promise<ToolExecutionResult>;

function skipOscSequence(value: string, index: number): number {
  let cursor = index + 2;
  while (cursor < value.length) {
    const code = value.charCodeAt(cursor);
    if (code === 0x07) return cursor + 1;
    if (code === 0x1b && value[cursor + 1] === "\\") return cursor + 2;
    cursor += 1;
  }
  return value.length;
}

function skipCsiSequence(value: string, index: number): number {
  let cursor = index + 2;
  while (cursor < value.length) {
    const code = value.charCodeAt(cursor);
    if (code >= 0x40 && code <= 0x7e) return cursor + 1;
    cursor += 1;
  }
  return value.length;
}

function skipEscStringSequence(value: string, index: number): number {
  let cursor = index + 2;
  while (cursor < value.length) {
    const code = value.charCodeAt(cursor);
    if (code === 0x07) return cursor + 1;
    if (code === 0x1b && value[cursor + 1] === "\\") return cursor + 2;
    cursor += 1;
  }
  return value.length;
}

function isControlCharacter(char: string): boolean {
  return char !== "\n" && char !== "\t" && isUnsafeTerminalCode(char.codePointAt(0)!);
}

function resolveColumns(io: TuiIO): number {
  const streamColumns = "columns" in io.output ? Number(io.output.columns) : NaN;
  const envColumns = Number(process.env.COLUMNS);
  const value = io.columns ?? (Number.isFinite(envColumns) ? envColumns : streamColumns);
  return Number.isFinite(value) && value > 0 ? Math.max(32, Math.floor(value)) : 80;
}

function fit(line: string, width: number): string {
  if (line.length <= width) return line;
  if (width <= 4) return line.slice(0, width);
  return `${line.slice(0, width - 3)}...`;
}

export function sanitizeTerminalText(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char === "\r") {
      output += "\n";
      if (value[index + 1] === "\n") index += 1;
      continue;
    }
    if (char === "\u001b") {
      const next = value[index + 1];
      if (next === "]") {
        index = skipOscSequence(value, index) - 1;
        continue;
      }
      if (next === "[") {
        index = skipCsiSequence(value, index) - 1;
        continue;
      }
      if (next === "P" || next === "^" || next === "_" || next === "X") {
        index = skipEscStringSequence(value, index) - 1;
        continue;
      }
      index += 1;
      continue;
    }
    if (isControlCharacter(char)) continue;
    output += char;
  }
  return output;
}

function writeLine(output: Writable, width: number, line = ""): void {
  for (const cleanLine of sanitizeTerminalText(line).split("\n")) {
    output.write(`${fit(cleanLine, width)}\n`);
  }
}

export function renderCommandOutput(text: string): string {
  const cleanText = sanitizeTerminalText(text);
  if (!cleanText) return "";
  return cleanText.endsWith("\n") ? cleanText : `${cleanText}\n`;
}

function writeCommandOutput(output: Writable, text: string): void {
  output.write(renderCommandOutput(text));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseJsonText(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function cliName(contract: CommandContract): string {
  return contract.adapters.cli.canonicalName ?? contract.id;
}

function compareStable(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function contractLabel(contract: CommandContract): string {
  return contract.adapters.tui.label ?? contract.summary.replace(/\.$/, "");
}

function tuiPolicyLabel(contract: CommandContract): string {
  if (TUI_ACCEPTED_WEB_READ_COMMAND_IDS.has(contract.id)) return "web read";
  if (contract.id === "cite.format") return "local read; pinpoint confirm";
  return "local read";
}

function sourcesLine(sources: unknown): string | undefined {
  if (!isRecord(sources)) return undefined;
  const entries = Object.entries(sources)
    .map(([source, status]) => `${source}=${String(status)}`)
    .sort(compareStable);
  return entries.length ? `Sources: ${entries.join(", ")}` : undefined;
}

function warningLine(warning: unknown): string | undefined {
  if (typeof warning === "string") return warning;
  if (!isRecord(warning)) return undefined;
  const message = asString(warning.message);
  const code = asString(warning.code);
  const source = asString(warning.source);
  if (!message) return undefined;
  const prefix = [source, code].filter(Boolean).join("/");
  return prefix ? `${prefix}: ${message}` : message;
}

function resultCitation(result: Record<string, unknown>): string | undefined {
  return (
    asString(result.aglc4) ??
    asString(result.citation) ??
    asString(result.neutralCitation) ??
    asString(result.reportedCitation)
  );
}

function renderSearchResult(result: Record<string, unknown>, index: number): string[] {
  const title = asString(result.title) ?? "(untitled result)";
  const lines = [`${index + 1}. ${title}`];
  const citation = resultCitation(result);
  if (citation) lines.push(`   ${citation}`);

  const facets = [
    asString(result.source) ? `source=${asString(result.source)}` : undefined,
    asString(result.discoverySource) ? `discovery=${asString(result.discoverySource)}` : undefined,
    asString(result.jurisdiction) ? `jurisdiction=${asString(result.jurisdiction)}` : undefined,
    asString(result.year) ? `year=${asString(result.year)}` : undefined,
    asString(result.type) ? `type=${asString(result.type)}` : undefined,
  ].filter(Boolean);
  if (facets.length > 0) lines.push(`   ${facets.join(", ")}`);

  const url = asString(result.url);
  if (url) lines.push(`   ${url}`);

  const summary = asString(result.summary);
  if (summary) lines.push(`   ${summary}`);
  return lines;
}

function renderSearchOutput(contract: CommandContract, parsed: unknown): string | undefined {
  const payload = Array.isArray(parsed) ? { results: parsed } : parsed;
  if (!isRecord(payload)) return undefined;

  const resultsValue = Array.isArray(payload.results) ? payload.results : undefined;
  if (!resultsValue) return undefined;

  const lines = [`${contractLabel(contract)} results: ${resultsValue.length}`];
  if (payload.degraded === true) {
    lines.push("DEGRADED: one or more configured sources were unavailable or incomplete.");
  }

  const sourceStatus = sourcesLine(payload.sources);
  if (sourceStatus) lines.push(sourceStatus);

  if (Array.isArray(payload.warnings) && payload.warnings.length > 0) {
    lines.push("Warnings:");
    for (const warning of payload.warnings) {
      const line = warningLine(warning);
      if (line) lines.push(`- ${line}`);
    }
  }

  if (resultsValue.length === 0) {
    lines.push("No results returned.");
  } else {
    lines.push("Results:");
    resultsValue.forEach((item, index) => {
      if (isRecord(item)) lines.push(...renderSearchResult(item, index));
      else lines.push(`${index + 1}. ${String(item)}`);
    });
  }

  return lines.join("\n");
}

function metadataLine(metadata: unknown): string | undefined {
  if (!isRecord(metadata)) return undefined;
  const name = asString(metadata.name);
  const version = asString(metadata.module_version);
  const snapshot = asString(metadata.snapshot_date);
  return [name, version, snapshot ? `snapshot ${snapshot}` : undefined].filter(Boolean).join(", ");
}

function renderListDataModules(parsed: unknown): string | undefined {
  if (!isRecord(parsed) || !Array.isArray(parsed.modules)) return undefined;
  const lines = [`Local data modules: ${String(parsed.count ?? parsed.modules.length)}`];
  if (parsed.modules.length === 0) {
    lines.push(
      "No installed ready modules found. Local recall commands will return not-found results.",
    );
    return lines.join("\n");
  }
  for (const moduleValue of parsed.modules) {
    if (!isRecord(moduleValue)) {
      lines.push(`- ${String(moduleValue)}`);
      continue;
    }
    const name = asString(moduleValue.name) ?? "(unnamed module)";
    const status = asString(moduleValue.status) ?? "unknown";
    const version = asString(moduleValue.module_version);
    const docs = asNumber(moduleValue.doc_count);
    const chunks = asNumber(moduleValue.chunk_count);
    const parts = [
      version ? `v${version}` : undefined,
      `status=${status}`,
      docs !== undefined ? `${docs} docs` : undefined,
      chunks !== undefined ? `${chunks} chunks` : undefined,
    ].filter(Boolean);
    lines.push(`- ${name} (${parts.join(", ")})`);
    const statusDetail = asString(moduleValue.statusDetail);
    if (statusDetail) lines.push(`  ${statusDetail}`);
  }
  return lines.join("\n");
}

function renderProvision(parsed: unknown): string | undefined {
  if (!isRecord(parsed) || !("found" in parsed)) return undefined;
  if (parsed.found !== true) {
    return "Local provision lookup: not found in installed ready modules.";
  }
  const lines = [
    `Provision: ${asString(parsed.citation) ?? "(unknown citation)"} ${asString(parsed.provision_ref) ?? ""}`.trim(),
  ];
  const module = metadataLine(parsed.metadata);
  if (module) lines.push(`Module: ${module}`);
  const url = asString(parsed.url);
  if (url) lines.push(`Source: ${url}`);
  const text = asString(parsed.text);
  if (text) lines.push("", text);
  return lines.join("\n");
}

function renderActStructureNode(
  node: Record<string, unknown>,
  depth = 0,
  lines: string[] = [],
): string[] {
  const indent = "  ".repeat(depth);
  lines.push(`${indent}- ${asString(node.label) ?? "(unlabelled node)"}`);
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    if (isRecord(child)) renderActStructureNode(child, depth + 1, lines);
  }
  return lines;
}

function renderActStructure(parsed: unknown): string | undefined {
  if (!isRecord(parsed) || !("found" in parsed)) return undefined;
  if (parsed.found !== true) {
    return "Local act structure: not found in installed ready modules.";
  }
  const lines = ["Local act structure:"];
  const module = metadataLine(parsed.metadata);
  if (module) lines.push(`Module: ${module}`);
  if (isRecord(parsed.root)) lines.push(...renderActStructureNode(parsed.root));
  return lines.join("\n");
}

function renderFindCiting(parsed: unknown): string | undefined {
  if (!isRecord(parsed) || !Array.isArray(parsed.hits)) return undefined;
  const lines = [`Local citing results: ${parsed.hits.length}`];
  if (parsed.found !== true || parsed.hits.length === 0) {
    lines.push("No local citing relationships found in installed ready modules.");
    return lines.join("\n");
  }
  parsed.hits.forEach((hit, index) => {
    if (!isRecord(hit)) return;
    lines.push(`${index + 1}. ${asString(hit.citation) ?? "(unknown citation)"}`);
    const facets = [
      asString(hit.kind) ? `kind=${asString(hit.kind)}` : undefined,
      asString(hit.pinpoint) ? `pinpoint=${asString(hit.pinpoint)}` : undefined,
      asString(hit.type) ? `type=${asString(hit.type)}` : undefined,
    ].filter(Boolean);
    if (facets.length > 0) lines.push(`   ${facets.join(", ")}`);
    const url = asString(hit.url);
    if (url) lines.push(`   ${url}`);
  });
  return lines.join("\n");
}

function renderSemanticSearch(parsed: unknown): string | undefined {
  if (!isRecord(parsed) || !Array.isArray(parsed.hits)) return undefined;
  const lines = [`Local semantic results: ${parsed.hits.length}`];
  if (Array.isArray(parsed.notes) && parsed.notes.length > 0) {
    lines.push("Notes:");
    for (const note of parsed.notes) lines.push(`- ${String(note)}`);
  }
  if (parsed.found !== true || parsed.hits.length === 0) {
    lines.push("No local semantic hits returned.");
    return lines.join("\n");
  }
  parsed.hits.forEach((hit, index) => {
    if (!isRecord(hit)) return;
    lines.push(`${index + 1}. ${asString(hit.citation) ?? "(unknown citation)"}`);
    const score = asNumber(hit.score);
    const provision = asString(hit.provision_ref);
    lines.push(
      `   ${[provision, score !== undefined ? `score=${score.toFixed(4)}` : undefined].filter(Boolean).join(", ")}`,
    );
    const text = asString(hit.text);
    if (text) lines.push(`   ${text}`);
  });
  return lines.join("\n");
}

export function renderTuiToolResult(
  contract: CommandContract,
  result: ToolExecutionResult,
): string {
  const parsed = parseJsonText(result.text);
  const rendered =
    contract.id === "search.cases" || contract.id === "search.legislation"
      ? renderSearchOutput(contract, parsed)
      : contract.id === "corpus.listDataModules"
        ? renderListDataModules(parsed)
        : contract.id === "corpus.getProvision"
          ? renderProvision(parsed)
          : contract.id === "corpus.getActStructure"
            ? renderActStructure(parsed)
            : contract.id === "graph.findCiting"
              ? renderFindCiting(parsed)
              : contract.id === "search.semanticLocal"
                ? renderSemanticSearch(parsed)
                : undefined;

  const output = rendered ?? result.text;
  const prefix = result.isError ? `ERROR: ${contract.id}\n` : "";
  return `${prefix}${output}`;
}

function renderContractLine(contract: CommandContract): string {
  return `  /${cliName(contract)} (${contract.id}, ${tuiPolicyLabel(contract)}) - ${contractLabel(contract)}`;
}

function isTuiExecutableContract(contract: CommandContract): boolean {
  if (
    !contract.adapters.cli.enabled ||
    !contract.adapters.mcp.enabled ||
    !contract.adapters.tui.enabled ||
    contract.dangerous ||
    contract.requiresConfirmation ||
    !TUI_ALLOWED_COMMAND_IDS.has(contract.id)
  ) {
    return false;
  }

  if (TUI_LOCAL_READ_COMMAND_IDS.has(contract.id)) {
    return (
      contract.sideEffectClass === "read_only_query" ||
      contract.sideEffectClass === "local_metadata_read"
    );
  }

  return (
    TUI_ACCEPTED_WEB_READ_COMMAND_IDS.has(contract.id) &&
    contract.sideEffectClass === "network_read" &&
    contract.adapters.tui.networkPolicy === "accepted_safe_default"
  );
}

export function renderTuiHeader(width: number): string {
  return [
    "jurisd TUI shell",
    `width ${width}: inline transcript/composer`,
    "framework: Node readline, no fullscreen terminal control in WB3",
    "commands: /commands, /help [command], /<command-id|cli-name> [args], /quit",
    "web search: search-cases and search-legislation use accepted read-only web defaults",
    "pinpoint citation formatting fetches --url only with --confirm-network-read",
  ]
    .map((line) => fit(line, width))
    .join("\n");
}

export function renderCommandPalette(width: number): string {
  const groups = new Map<string, CommandContract[]>();
  for (const contract of COMMAND_CONTRACTS.filter(isTuiExecutableContract)) {
    const group = contract.adapters.cli.group;
    groups.set(group, [...(groups.get(group) ?? []), contract]);
  }

  const lines = ["Command palette:"];
  for (const group of [...groups.keys()].sort(compareStable)) {
    lines.push(`${group}:`);
    for (const contract of groups
      .get(group)!
      .sort((a, b) => compareStable(cliName(a), cliName(b)))) {
      lines.push(renderContractLine(contract));
    }
  }

  return lines.map((line) => fit(line, width)).join("\n");
}

export function splitCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

export function resolveTuiCommand(token: string): CommandContract | undefined {
  const contract = findTuiCommandCandidate(token);
  return contract && isTuiExecutableContract(contract) ? contract : undefined;
}

function findTuiCommandCandidate(token: string): CommandContract | undefined {
  return (
    COMMAND_CONTRACTS.find((contract) => contract.id === token) ??
    getCommandContractByCliName(token)
  );
}

export function renderTuiHelp(token?: string): string {
  if (!token) {
    return [
      "Slash commands resolve through the command contract registry.",
      "Use /commands to inspect available governed commands.",
      "Use /help <command-id|cli-name> for command-specific help.",
      "Read-only web defaults are limited to /search-cases and /search-legislation.",
      "/format-citation --mode pinpoint fetches --url only with --confirm-network-read.",
    ].join("\n");
  }

  const contract = findTuiCommandCandidate(token);
  if (!contract) return `unknown help topic: ${token}`;

  const status = isTuiExecutableContract(contract)
    ? `TUI: enabled (${tuiPolicyLabel(contract)})`
    : "TUI: not enabled for dispatch";
  const authority = contract.adapters.tui.authorityNote
    ? `\nTUI authority: ${contract.adapters.tui.authorityNote}`
    : "";
  return `${renderCommandHelp(contract)}\n\n${status}${authority}`;
}

function isPinpointFormatCitation(
  contract: CommandContract,
  flags: Record<string, string>,
): boolean {
  return contract.id === "cite.format" && flags.mode === "pinpoint";
}

function isConfirmedNetworkRead(flags: Record<string, string>): boolean {
  const raw = flags[TUI_CONFIRM_NETWORK_READ_FLAG];
  return raw === "" || raw?.toLowerCase() === "true";
}

function removeTuiControlFlags(flags: Record<string, string>): Record<string, string> {
  const toolFlags = { ...flags };
  delete toolFlags[TUI_CONFIRM_NETWORK_READ_FLAG];
  return toolFlags;
}

function requiredTuiPositionals(
  contract: CommandContract,
  toolCommand: ToolCommand,
  flags: Record<string, string>,
): string[] {
  if (isPinpointFormatCitation(contract, flags)) return [];
  return toolCommand.positional;
}

function renderNetworkConfirmationPrompt(contract: CommandContract): string {
  return [
    `confirmation required: ${contract.id} mode=pinpoint fetches the supplied --url over the network`,
    `re-run the command with --${TUI_CONFIRM_NETWORK_READ_FLAG} to dispatch this network read`,
  ].join("\n");
}

async function dispatchSlashCommand(
  line: string,
  output: Writable,
  width: number,
  executor: TuiCommandExecutor,
): Promise<boolean> {
  const parts = splitCommandLine(line.slice(1));
  const token = parts[0];
  if (!token) return true;

  if (token === "quit" || token === "exit") {
    writeLine(output, width, "goodbye");
    return false;
  }
  if (token === "help") {
    writeLine(output, width, renderTuiHelp(parts[1]));
    return true;
  }
  if (token === "commands") {
    writeLine(output, width, renderCommandPalette(width));
    return true;
  }

  const contract = findTuiCommandCandidate(token);
  if (!contract) {
    writeLine(output, width, `unknown slash command: ${token}`);
    return true;
  }

  if (!isTuiExecutableContract(contract)) {
    writeLine(
      output,
      width,
      `registered command ${contract.id} is not enabled for WB3 TUI dispatch`,
    );
    return true;
  }

  if (parts.slice(1).includes("--help") || parts.slice(1).includes("-h")) {
    writeLine(output, width, renderTuiHelp(token));
    return true;
  }

  const toolCommand = contractToToolCommand(contract);
  const { positional, flags } = parseFlags(parts.slice(1), [
    ...toolCommand.boolean,
    TUI_CONFIRM_NETWORK_READ_FIELD,
  ]);
  const requiredPositionals = requiredTuiPositionals(contract, toolCommand, flags);
  if (positional.length < requiredPositionals.length) {
    const fields = requiredPositionals.map((field) => `<${field}>`).join(" ");
    writeLine(output, width, `usage: /${contract.id} ${fields} [--flag value ...]`);
    return true;
  }

  if (isPinpointFormatCitation(contract, flags) && !isConfirmedNetworkRead(flags)) {
    writeLine(output, width, renderNetworkConfirmationPrompt(contract));
    return true;
  }

  if (isPinpointFormatCitation(contract, flags)) {
    writeLine(output, width, `confirmed network read: ${contract.id} mode=pinpoint`);
  }

  writeLine(output, width, `dispatch: ${contract.id}`);
  const args = mapArgvToToolInput(toolCommand, positional, removeTuiControlFlags(flags));
  const result = await executor(toolCommand, args);
  writeCommandOutput(output, renderTuiToolResult(contract, result));
  if (result.isError) writeLine(output, width, `result: error from ${contract.id}`);
  return true;
}

export async function runTui(io: TuiIO): Promise<void> {
  const width = resolveColumns(io);
  const interactive = Boolean((io.input as { isTTY?: boolean }).isTTY);
  const executor = io.executor ?? executeToolCommand;
  writeLine(io.output, width, renderTuiHeader(width));
  writeLine(io.output, width);
  writeLine(io.output, width, renderCommandPalette(width));
  writeLine(io.output, width);

  const rl = createInterface({
    input: io.input,
    output: io.output,
    terminal: interactive,
  });

  rl.setPrompt("jurisd> ");
  if (interactive) rl.prompt();

  for await (const line of rl) {
    const trimmed = sanitizeTerminalText(line).trim();
    if (!trimmed) {
      if (interactive) rl.prompt();
      continue;
    }

    writeLine(io.output, width, `transcript> ${trimmed}`);
    if (trimmed.startsWith("/")) {
      const keepRunning = await dispatchSlashCommand(trimmed, io.output, width, executor);
      if (!keepRunning) break;
    } else {
      writeLine(
        io.output,
        width,
        "composer captured text; agentic drafting is not implemented in WB3",
      );
    }
    if (interactive) rl.prompt();
  }

  rl.close();
}
