# CLI/TUI Foundation PR 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Foundation PR 1 for jurisd: repo conventions, command contract architecture, MCP compatibility protection, CLI grouped-help skeleton, docs skeleton, and security checklist without implementing corpus, graph, vector, provider, completions, or full TUI features.

**Architecture:** Introduce a typed command contract layer that becomes the single metadata source for CLI, docs, future TUI, future completions, and MCP compatibility checks. Keep existing MCP tool behaviour stable by registering the current 15 tools exactly as before, while adding generated compatibility reference tests and CLI routing through command contract metadata. This PR is intentionally a foundation slice, not the full legal reasoning workbench.

**Tech Stack:** TypeScript, Node.js ESM, zod, MCP SDK, Vitest, existing no-framework CLI dispatch, markdown docs.

---

## Team-leader operating model

This plan is intended for an agent swarm with one team leader and short-lived worker agents.

Team leader responsibilities:

1. Keep the branch clean and protect Russ's unrelated working-tree changes.
2. Assign one task at a time to workers, or run independent doc and test tasks in parallel.
3. Review each worker diff before allowing the next dependent task.
4. Run the task-specific tests before marking a task complete.
5. Run final verification before PR creation.
6. Do not commit secrets or environment files.
7. Do not add AI-generated or co-authored commit trailers.

Known pre-existing uncommitted files at planning time:

```text
M build.sh
?? docs/DOGFOODING.md
?? podman-build.sh
```

Workers must not modify or stage those files unless the team leader explicitly changes scope.

Recommended swarm allocation:

```text
Task 1  docs/conventions worker
Task 2  MCP compatibility worker
Task 3  command contract worker
Task 4  CLI routing/help worker
Task 5  docs skeleton worker
Task 6  security checklist worker
Task 7  integration/verification worker
Task 8  team leader final review and PR
```

---

## File structure

Create:

- `AGENTS.md`
  - Agent-facing repo rules, architecture map, generated-file policy, security constraints, how to add a command once.
- `docs/CLI.md`
  - Authored CLI guide skeleton and grouped command overview.
- `docs/SECURITY-AUTHORITY.md`
  - Authority, side-effect classes, terminal safety, credentials, MCP exposure, and first PR security checklist.
- `docs/MCP-COMPATIBILITY.md`
  - Generated or committed reference listing the current MCP compatibility set.
- `src/commands/types.ts`
  - Command contract and authority metadata types.
- `src/commands/contracts.ts`
  - Command contracts for the existing 15 MCP-backed CLI tools plus CLI-only module-management commands.
- `src/commands/help.ts`
  - Pure help rendering from command contracts.
- `src/commands/legacy-cli.ts`
  - Compatibility helpers that map existing flat commands to command contracts.
- `src/test/unit/command-contracts.test.ts`
  - Registry completeness and metadata tests.
- `src/test/unit/mcp-compatibility.test.ts`
  - Current 15 MCP tool compatibility reference test.
- `src/test/unit/cli-help.test.ts`
  - Help rendering and grouped command UX tests.

Modify:

- `src/cli.ts`
  - Replace hard-coded `TOOL_COMMANDS` with contract-derived routing while preserving `runCli()` behaviour and module-management commands.
- `src/test/unit/cli.test.ts`
  - Update mapping tests to use exported contract-derived command metadata, not inlined duplicate shapes.
- `src/test/unit/tool-surface.test.ts`
  - Keep existing exact 15-tool surface test, optionally import expected names from the compatibility reference.
- `CONTRIBUTING.md`
  - Add command contract, docs, security, and test requirements.
- `README.md`
  - Add a short CLI/TUI foundation note and link to `docs/CLI.md`, without claiming unbuilt corpus/graph/vector functionality.

Do not modify in this PR:

- `src/server.ts`, except if a compile-only import needs changing. The current MCP server behaviour must stay stable.
- `src/services/*`, except if tests reveal a type-only export is needed.
- `package.json`, unless a test script addition is approved by the team leader.

---

## Task 1: Add repo conventions and contributor guardrails

**Files:**

- Create: `AGENTS.md`
- Modify: `CONTRIBUTING.md`

- [ ] **Step 1: Write failing convention-doc presence test by grep command**

Run before creating files:

```bash
test -f AGENTS.md && grep -q "command contract registry" AGENTS.md
```

Expected: FAIL because `AGENTS.md` does not exist.

- [ ] **Step 2: Create `AGENTS.md`**

Write this exact content, then adjust only if the repo already has conflicting instructions discovered during implementation:

```markdown
# Agent instructions for jurisd

## Purpose

jurisd is a source-backed Australian legal research and provenance instrument over a governed command surface. It exposes legal research capabilities through MCP, CLI, and future TUI adapters.

Do not describe jurisd as a chatbot, oracle, AI companion, or autonomous legal advice system.

## Current foundation architecture

- `src/server.ts` registers the current MCP tool surface.
- `src/cli.ts` handles CLI entry before the server starts.
- `src/commands/types.ts` defines command contract and authority metadata types.
- `src/commands/contracts.ts` is the command contract registry for CLI/docs/future adapters.
- `docs/MCP-COMPATIBILITY.md` records the current MCP compatibility set.

## Command contract rule

Add commands once through the command contract registry.

Every public command needs:

- stable command id
- synopsis
- summary
- arguments
- flags
- stdin mode
- output modes
- exit codes
- validation schema reference or adapter mapping
- stability level
- side-effect class
- terminal safety policy
- capability gates
- result contract

Adapter-specific metadata is required when that adapter is enabled.

## MCP surface rule

MCP exposure is curated. Do not expose operator, install, update, destructive, filesystem-write, or network-write commands over MCP unless a later authority decision explicitly permits it.

Existing MCP tool names are compatibility-sensitive. Update the compatibility reference and tests before changing the tool surface.

## Security invariants

- No secrets in code, docs, logs, tests, command output, or examples.
- No shell execution with user-controlled strings.
- Treat CLI args, TUI input, MCP input, provider output, source text, filenames, URLs, and completion candidates as untrusted.
- Keep stdout for primary output and stderr for diagnostics.
- JSON and NDJSON output must not contain terminal decoration.
- Terminal output must strip or neutralise unsafe ANSI, OSC, control characters, and bidi controls when it renders untrusted text.

## Generated files

Generated command references and compatibility references must be deterministic. If a generated section changes, commit the generator input and output together.

## Required checks before marking code complete

Run the smallest relevant checks first, then the full suite before handoff:

```bash
npm run build
npm test
npm run lint
npm run format:check
```

If a check fails twice, stop and reassess rather than iterating blindly.

## Anti-slop documentation rules

- Use concrete commands and examples.
- Do not write vague product promises.
- Do not claim graph, vector, corpus, Isaacus, Evidence Pack, or agentic TUI functionality exists before it is built.
- Separate authored guides from generated references.
```

- [ ] **Step 3: Extend `CONTRIBUTING.md`**

Add this section after the existing `## Development Guidelines` heading or immediately before it if the heading content is not easy to extend:

```markdown
### Command contracts and public surfaces

jurisd has multiple public adapters: MCP, CLI, and future TUI. Do not add or change a public command by editing one adapter only.

For any command-surface change:

1. Update the command contract registry.
2. Update or regenerate public help/reference docs.
3. Update MCP compatibility reference if MCP exposure changes.
4. Add or update tests for CLI routing, help, metadata completeness, and MCP compatibility.
5. Document side-effect class, capability gates, and output behaviour.

MCP tools are curated. Operator/install/update/destructive commands remain CLI-only unless a later authority decision explicitly allows MCP exposure.

### Security-sensitive changes

Run an explicit security review for changes involving:

- URLs or source fetching
- local file paths
- credentials or provider keys
- terminal rendering
- shell completions
- MCP tool exposure
- command parsing
- graph/corpus/review mutations

Never commit secrets, `.env` files, provider tokens, cookies, or credential-bearing URLs.
```

- [ ] **Step 4: Verify docs exist and contain key rules**

Run:

```bash
grep -q "command contract registry" AGENTS.md
grep -q "MCP tools are curated" AGENTS.md
grep -q "Command contracts and public surfaces" CONTRIBUTING.md
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit Task 1**

```bash
git add AGENTS.md CONTRIBUTING.md
git commit -m "docs: add agent command-surface conventions"
```

---

## Task 2: Add MCP compatibility reference and tests

**Files:**

- Create: `docs/MCP-COMPATIBILITY.md`
- Create: `src/test/unit/mcp-compatibility.test.ts`
- Modify: `src/test/unit/tool-surface.test.ts` only if sharing expected names reduces duplication without hiding intent.

- [ ] **Step 1: Write failing MCP compatibility test**

Create `src/test/unit/mcp-compatibility.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMcpServer } from "../../server.js";

const MCP_COMPATIBILITY_TOOL_NAMES = [
  "bibliography",
  "cite",
  "fetch_document_text",
  "find_citing",
  "format_citation",
  "get_act_structure",
  "get_provision",
  "list_data_modules",
  "resolve_citation",
  "search_cases",
  "search_legislation",
  "semantic_search_local",
].sort();

interface ToolBearingServer {
  _registeredTools: Record<string, unknown>;
}

function registeredToolNames(): string[] {
  const server = createMcpServer() as unknown as ToolBearingServer;
  return Object.keys(server._registeredTools).sort();
}

describe("MCP compatibility reference", () => {
  it("keeps the current 15 MCP tool names stable", () => {
    expect(registeredToolNames()).toEqual(MCP_COMPATIBILITY_TOOL_NAMES);
  });

  it("documents the current compatibility count", () => {
    expect(MCP_COMPATIBILITY_TOOL_NAMES).toHaveLength(15);
  });
});
```

- [ ] **Step 2: Run the test**

Run:

```bash
npx vitest run src/test/unit/mcp-compatibility.test.ts
```

Expected: PASS. This is a characterisation test. If it fails, stop and inspect the current MCP surface before continuing.

- [ ] **Step 3: Create `docs/MCP-COMPATIBILITY.md`**

Write:

```markdown
# MCP compatibility reference

This file records the current jurisd MCP tool surface for Foundation PR 1. The purpose is compatibility protection, not product documentation.

## Compatibility rule

MCP tool names are stable `snake_case` adapter aliases. Do not rename, remove, or add MCP tools without updating this reference, the MCP compatibility test, and release notes.

MCP exposure is curated. Operator, install, update, destructive, filesystem-write, and network-write commands remain CLI-only unless a later authority decision explicitly allows them.

## Current tool set

| Tool | Status | Notes |
|---|---|---|
| `bibliography` | stable | Citation cache bibliography output |
| `cite` | stable | Citation helper |
| `fetch_document_text` | stable | Fetch document text from allowed sources |
| `find_citing` | stable | Local module graph recall |
| `format_citation` | stable | AGLC4 citation formatting |
| `get_act_structure` | stable | Local module act structure |
| `get_provision` | stable | Local module provision lookup |
| `list_data_modules` | stable | Local module listing |
| `resolve_citation` | stable | Citation resolution |
| `search_cases` | stable | Case search |
| `search_legislation` | stable | Legislation search |
| `semantic_search_local` | stable | Local semantic search over installed modules |

## Verification

The compatibility test is `src/test/unit/mcp-compatibility.test.ts`.

Run:

```bash
npx vitest run src/test/unit/mcp-compatibility.test.ts src/test/unit/tool-surface.test.ts
```

Expected: both tests pass and report exactly 15 registered MCP tools.
```

- [ ] **Step 4: Verify docs and tests**

Run:

```bash
grep -q "search_cases" docs/MCP-COMPATIBILITY.md
npx vitest run src/test/unit/mcp-compatibility.test.ts src/test/unit/tool-surface.test.ts
```

Expected: grep exits 0, tests pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add docs/MCP-COMPATIBILITY.md src/test/unit/mcp-compatibility.test.ts src/test/unit/tool-surface.test.ts
git commit -m "test: pin MCP compatibility surface"
```

If `src/test/unit/tool-surface.test.ts` was not changed, omit it from `git add`.

---

## Task 3: Introduce command contract types and registry

**Files:**

- Create: `src/commands/types.ts`
- Create: `src/commands/contracts.ts`
- Create: `src/test/unit/command-contracts.test.ts`

- [ ] **Step 1: Create failing contract test**

Create `src/test/unit/command-contracts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COMMAND_CONTRACTS, getCommandContractByCliName } from "../../commands/contracts.js";

const REQUIRED_MCP_TOOLS = [
  "bibliography",
  "cite",
  "fetch_document_text",
  "find_citing",
  "format_citation",
  "get_act_structure",
  "get_provision",
  "list_data_modules",
  "resolve_citation",
  "search_cases",
  "search_legislation",
  "semantic_search_local",
].sort();

describe("command contracts", () => {
  it("defines one contract for each current MCP-backed CLI command", () => {
    const mcpTools = COMMAND_CONTRACTS
      .filter((contract) => contract.adapters.mcp.enabled)
      .map((contract) => contract.adapters.mcp.toolName)
      .sort();

    expect(mcpTools).toEqual(REQUIRED_MCP_TOOLS);
  });

  it("requires command metadata used by help and docs", () => {
    for (const contract of COMMAND_CONTRACTS) {
      expect(contract.id).toMatch(/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/);
      expect(contract.summary.length).toBeGreaterThan(8);
      expect(contract.synopsis.length).toBeGreaterThan(0);
      expect(contract.sideEffectClass).toBeTruthy();
      expect(contract.resultContract).toMatch(/\.v\d+$/);
      expect(contract.outputModes).toContain("human");
      expect(contract.outputModes).toContain("json");
    }
  });

  it("maps existing flat CLI command names to contracts", () => {
    expect(getCommandContractByCliName("search-cases")?.id).toBe("search.cases");
    expect(getCommandContractByCliName("format-citation")?.id).toBe("cite.format");
    expect(getCommandContractByCliName("semantic-search-local")?.id).toBe("search.semanticLocal");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/test/unit/command-contracts.test.ts
```

Expected: FAIL because `src/commands/contracts.ts` does not exist.

- [ ] **Step 3: Create `src/commands/types.ts`**

```ts
export type OutputMode = "human" | "json" | "ndjson" | "plain" | "markdown";

export type SideEffectClass =
  | "read_only_query"
  | "local_metadata_read"
  | "network_read"
  | "credential_dependent_read"
  | "corpus_write"
  | "graph_write"
  | "review_state_write"
  | "export_write"
  | "filesystem_write"
  | "network_write"
  | "destructive_admin";

export type Stability = "stable" | "experimental" | "future";

export interface CommandArgumentContract {
  name: string;
  required: boolean;
  summary: string;
}

export interface CommandFlagContract {
  name: string;
  type: "string" | "number" | "boolean" | "array";
  summary: string;
  values?: string[];
}

export interface CliAdapterContract {
  enabled: boolean;
  canonicalName?: string;
  aliases: string[];
  positional: string[];
  numeric: string[];
  boolean: string[];
  array: string[];
  group: string;
}

export interface McpAdapterContract {
  enabled: boolean;
  toolName?: string;
}

export interface TuiAdapterContract {
  enabled: boolean;
  label?: string;
}

export interface CommandContract {
  id: string;
  synopsis: string;
  summary: string;
  description: string;
  stability: Stability;
  sideEffectClass: SideEffectClass;
  dangerous: boolean;
  requiresConfirmation: boolean;
  stdinMode: "none" | "json" | "ndjson" | "text";
  outputModes: OutputMode[];
  exitCodes: number[];
  resultContract: string;
  capabilityGates: string[];
  arguments: CommandArgumentContract[];
  flags: CommandFlagContract[];
  examples: string[];
  adapters: {
    cli: CliAdapterContract;
    mcp: McpAdapterContract;
    tui: TuiAdapterContract;
  };
}
```

- [ ] **Step 4: Create `src/commands/contracts.ts` with current contracts**

Use this structure. Include all 15 MCP-backed contracts and 3 CLI-only module operator contracts. Do not expose CLI-only operator contracts over MCP.

```ts
import type { CommandContract } from "./types.js";

export const COMMAND_CONTRACTS: CommandContract[] = [
  {
    id: "search.legislation",
    synopsis: "jurisd search legislation <query> [--jurisdiction cth] [--limit 10]",
    summary: "Search Australian and New Zealand legislation.",
    description: "Search legislation using the existing MCP search_legislation tool.",
    stability: "stable",
    sideEffectClass: "network_read",
    dangerous: false,
    requiresConfirmation: false,
    stdinMode: "none",
    outputModes: ["human", "json", "plain"],
    exitCodes: [0, 1, 2, 3, 4, 6],
    resultContract: "legal_search_results.v1",
    capabilityGates: [],
    arguments: [{ name: "query", required: true, summary: "Search query." }],
    flags: [
      { name: "jurisdiction", type: "string", summary: "Jurisdiction code." },
      { name: "limit", type: "number", summary: "Maximum result count." },
      { name: "offset", type: "number", summary: "Pagination offset." },
      { name: "format", type: "string", summary: "Output format." },
      { name: "sort-by", type: "string", summary: "Sort mode." },
      { name: "method", type: "string", summary: "Search method." },
    ],
    examples: ["jurisd search legislation \"family violence\" --jurisdiction nsw"],
    adapters: {
      cli: {
        enabled: true,
        canonicalName: "search-legislation",
        aliases: ["search-legislation"],
        positional: ["query"],
        numeric: ["limit", "offset"],
        boolean: [],
        array: [],
        group: "search",
      },
      mcp: { enabled: true, toolName: "search_legislation" },
      tui: { enabled: false, label: "Search legislation" },
    },
  },
  {
    id: "search.cases",
    synopsis: "jurisd search cases <query> [--jurisdiction cth] [--limit 10]",
    summary: "Search Australian and New Zealand case law.",
    description: "Search cases using the existing MCP search_cases tool.",
    stability: "stable",
    sideEffectClass: "network_read",
    dangerous: false,
    requiresConfirmation: false,
    stdinMode: "none",
    outputModes: ["human", "json", "plain"],
    exitCodes: [0, 1, 2, 3, 4, 6],
    resultContract: "legal_search_results.v1",
    capabilityGates: [],
    arguments: [{ name: "query", required: true, summary: "Search query." }],
    flags: [
      { name: "jurisdiction", type: "string", summary: "Jurisdiction code." },
      { name: "limit", type: "number", summary: "Maximum result count." },
      { name: "offset", type: "number", summary: "Pagination offset." },
      { name: "format", type: "string", summary: "Output format." },
      { name: "sort-by", type: "string", summary: "Sort mode." },
      { name: "method", type: "string", summary: "Search method." },
    ],
    examples: ["jurisd search cases \"native title\" --jurisdiction cth --limit 5"],
    adapters: {
      cli: {
        enabled: true,
        canonicalName: "search-cases",
        aliases: ["search-cases"],
        positional: ["query"],
        numeric: ["limit", "offset"],
        boolean: [],
        array: [],
        group: "search",
      },
      mcp: { enabled: true, toolName: "search_cases" },
      tui: { enabled: false, label: "Search cases" },
    },
  },
  makeContract("source.fetchDocument", "fetch-document-text", "fetch_document_text", "source", "network_read", ["url"], [], [], [], "Fetch full text for a source document.", "jurisd fetch-document-text <url>"),
  makeContract("cite.format", "format-citation", "format_citation", "cite", "read_only_query", ["title"], ["footnoteRef", "pinpointPara", "pinpointPage", "paragraphNumber"], [], [], "Format an AGLC4 citation.", "jurisd format-citation 'Mabo v Queensland (No 2)' --neutral-citation '[1992] HCA 23'"),
  makeContract("cite.resolve", "resolve-citation", "resolve_citation", "cite", "network_read", ["citation"], [], [], [], "Resolve a citation to an authoritative source.", "jurisd resolve-citation '[1992] HCA 23'"),
  makeContract("cite.create", "cite", "cite", "cite", "local_metadata_read", ["title"], ["year", "footnoteNumber"], [], ["keywords"], "Create or record a citation cache entry.", "jurisd cite 'Mabo v Queensland (No 2)' --year 1992"),
  makeContract("cite.bibliography", "bibliography", "bibliography", "cite", "local_metadata_read", [], [], [], [], "Render a bibliography from cached citations.", "jurisd bibliography"),
  makeContract("corpus.getProvision", "get-provision", "get_provision", "corpus", "local_metadata_read", ["act", "provision"], [], [], [], "Get a provision from an installed local data module.", "jurisd get-provision 'Family Law Act 1975 (Cth)' 's 60CC'"),
  makeContract("corpus.getActStructure", "get-act-structure", "get_act_structure", "corpus", "local_metadata_read", ["act"], ["depth"], [], [], "Get act structure from an installed local data module.", "jurisd get-act-structure 'Family Law Act 1975 (Cth)'"),
  makeContract("graph.findCiting", "find-citing", "find_citing", "graph", "local_metadata_read", ["target"], ["limit"], [], ["kinds"], "Find locally indexed items citing or considering a target.", "jurisd find-citing '[1992] HCA 23' --kinds cites,considers"),
  makeContract("search.semanticLocal", "semantic-search-local", "semantic_search_local", "search", "local_metadata_read", ["query"], ["k"], [], [], "Run local semantic search over installed data modules.", "jurisd semantic-search-local 'restraint of trade' --k 5"),
  makeContract("corpus.listDataModules", "list-data-modules", "list_data_modules", "corpus", "local_metadata_read", [], [], ["refresh", "includeInvalid"], [], "List installed local data modules.", "jurisd list-data-modules --include-invalid true"),
];

export function getCommandContractByCliName(name: string): CommandContract | undefined {
  return COMMAND_CONTRACTS.find(
    (contract) =>
      contract.adapters.cli.enabled &&
      (contract.adapters.cli.canonicalName === name || contract.adapters.cli.aliases.includes(name)),
  );
}

export function getMcpBackedCommandContracts(): CommandContract[] {
  return COMMAND_CONTRACTS.filter((contract) => contract.adapters.mcp.enabled);
}
```

Add this helper above `COMMAND_CONTRACTS` in `src/commands/contracts.ts` so the `makeContract(...)` calls above compile:

```ts
function makeContract(
  id: string,
  cliName: string,
  mcpToolName: string,
  group: string,
  sideEffectClass: CommandContract["sideEffectClass"],
  positional: string[],
  numeric: string[],
  boolean: string[],
  array: string[],
  summary: string,
  synopsis: string,
): CommandContract {
  return {
    id,
    synopsis,
    summary,
    description: summary,
    stability: "stable",
    sideEffectClass,
    dangerous: false,
    requiresConfirmation: false,
    stdinMode: "none",
    outputModes: ["human", "json", "plain"],
    exitCodes: [0, 1, 2],
    resultContract: `${id}.v1`,
    capabilityGates: [],
    arguments: positional.map((name) => ({ name, required: true, summary: `${name} argument.` })),
    flags: [
      ...numeric.map((name) => ({ name: name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), type: "number" as const, summary: `${name} value.` })),
      ...boolean.map((name) => ({ name: name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), type: "boolean" as const, summary: `${name} toggle.` })),
      ...array.map((name) => ({ name, type: "array" as const, summary: `${name} values.` })),
    ],
    examples: [synopsis],
    adapters: {
      cli: {
        enabled: true,
        canonicalName: cliName,
        aliases: [cliName],
        positional,
        numeric,
        boolean,
        array,
        group,
      },
      mcp: { enabled: true, toolName: mcpToolName },
      tui: { enabled: false, label: summary.replace(/\.$/, "") },
    },
  };
}
```

For CLI-only module commands, add three contracts with MCP disabled:

```ts
makeCliOnlyContract("modules.fetch", "fetch-module", "modules", "filesystem_write", ["name"], [], [], [], "Fetch and install a data module.", "jurisd fetch-module <name>"),
makeCliOnlyContract("modules.verify", "verify-module", "modules", "local_metadata_read", ["name"], [], [], [], "Verify an installed data module.", "jurisd verify-module <name>"),
makeCliOnlyContract("modules.list", "list-modules", "modules", "local_metadata_read", [], [], [], [], "List installed data modules via the operator CLI.", "jurisd list-modules"),
```

Define `makeCliOnlyContract(...)` by copying `makeContract(...)` and changing only:

```ts
mcp: { enabled: false }
```

These CLI-only contracts are metadata for help/docs/future adapters only. Keep the existing direct implementation of `fetch-module`, `verify-module`, and `list-modules` in `src/cli.ts` unchanged in Foundation PR 1.

- [ ] **Step 5: Run contract tests**

```bash
npx vitest run src/test/unit/command-contracts.test.ts
```

Expected: PASS after all contracts are filled.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/commands/types.ts src/commands/contracts.ts src/test/unit/command-contracts.test.ts
git commit -m "feat: add command contract registry"
```

---

## Task 4: Route CLI tool commands through command contracts

**Files:**

- Create: `src/commands/legacy-cli.ts`
- Modify: `src/cli.ts`
- Modify: `src/test/unit/cli.test.ts`

- [ ] **Step 1: Create failing test expectation for contract lookup**

Modify `src/test/unit/cli.test.ts` imports:

```ts
import { getCommandContractByCliName } from "../../commands/contracts.js";
```

Add this test under `describe("runCli routing", ...)`:

```ts
it("resolves existing flat CLI tool commands from command contracts", () => {
  expect(getCommandContractByCliName("search-cases")?.adapters.mcp.toolName).toBe("search_cases");
  expect(getCommandContractByCliName("get-provision")?.adapters.mcp.toolName).toBe("get_provision");
});
```

- [ ] **Step 2: Run the CLI tests**

```bash
npx vitest run src/test/unit/cli.test.ts
```

Expected: PASS if Task 3 is complete. If it fails, fix contract names before continuing.

- [ ] **Step 3: Create `src/commands/legacy-cli.ts`**

```ts
import type { CommandContract } from "./types.js";

export interface ToolCommand {
  tool: string;
  positional: string[];
  numeric: string[];
  boolean: string[];
  array: string[];
}

export function contractToToolCommand(contract: CommandContract): ToolCommand {
  if (!contract.adapters.mcp.enabled || !contract.adapters.mcp.toolName) {
    throw new Error(`Command ${contract.id} is not backed by an MCP tool`);
  }

  return {
    tool: contract.adapters.mcp.toolName,
    positional: contract.adapters.cli.positional,
    numeric: contract.adapters.cli.numeric,
    boolean: contract.adapters.cli.boolean,
    array: contract.adapters.cli.array,
  };
}
```

- [ ] **Step 4: Modify `src/cli.ts` imports**

Add:

```ts
import { getCommandContractByCliName } from "./commands/contracts.js";
import { contractToToolCommand } from "./commands/legacy-cli.js";
```

Remove or stop using the old `TOOL_COMMANDS` object. Keep the `ToolCommand` interface only if still needed by `mapArgvToToolInput`, or import it from `legacy-cli.ts`.

- [ ] **Step 5: Modify `runCli()` contract lookup**

Replace:

```ts
const toolCommand = TOOL_COMMANDS[command];
if (toolCommand) {
```

with:

```ts
const contract = getCommandContractByCliName(command);
const toolCommand = contract?.adapters.mcp.enabled ? contractToToolCommand(contract) : undefined;
if (toolCommand) {
```

Keep the rest of the block unchanged.

- [ ] **Step 6: Run CLI tests**

```bash
npx vitest run src/test/unit/cli.test.ts src/test/unit/command-contracts.test.ts
```

Expected: PASS. Existing loopback tests must still pass.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/cli.ts src/commands/legacy-cli.ts src/test/unit/cli.test.ts
git commit -m "refactor: derive CLI tool routing from command contracts"
```

---

## Task 5: Add contract-driven help rendering skeleton

**Files:**

- Create: `src/commands/help.ts`
- Create: `src/test/unit/cli-help.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write failing help renderer tests**

Create `src/test/unit/cli-help.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderCommandHelp, renderTopLevelHelp } from "../../commands/help.js";
import { getCommandContractByCliName } from "../../commands/contracts.js";

describe("CLI help rendering", () => {
  it("renders task-oriented top-level help", () => {
    const help = renderTopLevelHelp();
    expect(help).toContain("jurisd");
    expect(help).toContain("search");
    expect(help).toContain("cite");
    expect(help).toContain("mcp");
    expect(help).toContain("Run `jurisd help <topic>`");
  });

  it("renders per-command help from a command contract", () => {
    const contract = getCommandContractByCliName("search-cases");
    expect(contract).toBeDefined();
    const help = renderCommandHelp(contract!);
    expect(help).toContain("Search Australian and New Zealand case law");
    expect(help).toContain("Usage:");
    expect(help).toContain("Examples:");
    expect(help).toContain("--limit");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/test/unit/cli-help.test.ts
```

Expected: FAIL because `src/commands/help.ts` does not exist.

- [ ] **Step 3: Create `src/commands/help.ts`**

```ts
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
] as const;

export function renderTopLevelHelp(): string {
  const lines = [
    "jurisd - source-backed Australian legal research",
    "",
    "Usage:",
    "  jurisd <command> [arguments] [flags]",
    "  jurisd help <topic>",
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
  const usage = contract.synopsis;
  const flagLines = contract.flags.length
    ? contract.flags.map((flag) => `  --${flag.name.padEnd(18)} ${flag.summary}`)
    : ["  (none)"];
  const argLines = contract.arguments.length
    ? contract.arguments.map((arg) => `  ${arg.name.padEnd(20)} ${arg.summary}`)
    : ["  (none)"];
  const exampleLines = contract.examples.length ? contract.examples.map((example) => `  ${example}`) : ["  (none)"];

  return [
    contract.summary,
    "",
    "Usage:",
    `  ${usage}`,
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
  return COMMAND_CONTRACTS
    .filter((contract) => contract.adapters.cli.enabled)
    .map((contract) => `${contract.adapters.cli.canonicalName ?? contract.id}: ${contract.summary}`)
    .sort()
    .join("\n");
}
```

- [ ] **Step 4: Wire help into `src/cli.ts`**

Import:

```ts
import { renderCommandHelp, renderCommandList, renderTopLevelHelp } from "./commands/help.js";
import { getCommandContractByCliName } from "./commands/contracts.js";
```

Update `printHelp()` to use:

```ts
function printHelp(): void {
  console.error(renderTopLevelHelp());
}
```

Add handling in `runCli()` after `if (command === "help") {` logic. Replace the current help branch with:

```ts
if (command === "help") {
  const topic = rest[0];
  if (!topic) {
    console.error(renderTopLevelHelp());
  } else if (topic === "commands") {
    console.error(renderCommandList());
  } else {
    const contract = getCommandContractByCliName(topic);
    console.error(contract ? renderCommandHelp(contract) : `unknown help topic: ${topic}`);
    if (!contract) process.exitCode = 2;
  }
  if (process.exitCode !== 2) process.exitCode = 0;
  return true;
}
```

Also before executing a tool command, support per-command help:

```ts
if (contract && (rest.includes("--help") || rest.includes("-h"))) {
  console.error(renderCommandHelp(contract));
  process.exitCode = 0;
  return true;
}
```

- [ ] **Step 5: Run help and CLI tests**

```bash
npx vitest run src/test/unit/cli-help.test.ts src/test/unit/cli.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/commands/help.ts src/cli.ts src/test/unit/cli-help.test.ts
git commit -m "feat: render CLI help from command contracts"
```

---

## Task 6: Add docs skeleton and security checklist

**Files:**

- Create: `docs/CLI.md`
- Create: `docs/SECURITY-AUTHORITY.md`
- Modify: `README.md`

- [ ] **Step 1: Create `docs/CLI.md`**

```markdown
# jurisd CLI guide

jurisd is a source-backed Australian legal research tool with MCP integration and a growing CLI surface.

This guide documents the Foundation PR 1 CLI shape. It does not claim corpus import, vector search, graph traversal, Evidence Pack export, Isaacus integration, or agentic TUI functionality is implemented yet.

## Current modes

```bash
jurisd
```

Starts the MCP server unless a CLI command handles the arguments first.

```bash
jurisd help
jurisd help commands
jurisd search-cases "native title"
jurisd format-citation "Mabo v Queensland (No 2)" --neutral-citation "[1992] HCA 23"
```

## Command groups

The long-term CLI is grouped by task:

| Group | Purpose | Status |
|---|---|---|
| `search` | Search cases, legislation, citations, and local modules | Foundation metadata only |
| `cite` | Resolve, format, cache, and list citations | Foundation metadata only |
| `corpus` | Inspect local modules and future corpora | Foundation metadata only |
| `graph` | Future relationship tracing and closed-world graph queries | Not implemented |
| `review` | Future review-state workflow | Not implemented |
| `enrich` | Future provider-backed enrichment jobs | Not implemented |
| `export` | Future source-backed exports and Evidence Packs | Not implemented |
| `mcp` | MCP server and compatibility inspection | Partially implemented by server startup |
| `doctor` | Future capability and degradation diagnostics | Not implemented |
| `tui` | Future terminal workbench | Not implemented in Foundation PR 1 |

## Compatibility aliases

Existing flat commands remain available during the foundation work, including:

- `search-cases`
- `search-legislation`
- `format-citation`
- `resolve-citation`
- `get-provision`
- `semantic-search-local`

## Output rules

- stdout is primary output.
- stderr is diagnostics and help text.
- JSON output must remain valid JSON.
- Human output is not a stable parsing contract.

## Exit codes

| Code | Meaning |
|---:|---|
| 0 | success |
| 1 | general failure |
| 2 | usage or validation error |
| 3 | no results |
| 4 | source unavailable |
| 5 | auth failure |
| 6 | network failure |
| 7 | parse or citation resolution failure |
| 8 | partial success |
| 9 | unsafe operation refused |
| 10 | configuration error |
| 11 | internal error |
| 130 | interrupted |
```

- [ ] **Step 2: Create `docs/SECURITY-AUTHORITY.md`**

```markdown
# Security and authority model

This file records the Foundation PR 1 security posture for jurisd command contracts, CLI routing, and MCP compatibility.

## Trust boundaries

- CLI arguments are untrusted.
- MCP inputs are untrusted.
- Future TUI input is untrusted.
- Source text and provider responses are untrusted display data.
- Completion candidates and descriptions are code-adjacent output and must be treated as untrusted.
- Credentials are configuration secrets.

## Side-effect classes

Commands declare one side-effect class:

- `read_only_query`
- `local_metadata_read`
- `network_read`
- `credential_dependent_read`
- `corpus_write`
- `graph_write`
- `review_state_write`
- `export_write`
- `filesystem_write`
- `network_write`
- `destructive_admin`

## MCP exposure

MCP exposure is curated. Do not expose operator, install, update, destructive, filesystem-write, or network-write commands over MCP unless a later authority decision explicitly allows it.

## Terminal safety

Untrusted text must not produce terminal control effects. Renderers must strip or neutralise unsafe ANSI, OSC, BEL, carriage returns, title changes, bidi controls, and other unsafe control characters before rendering source/provider text.

## Credential handling

Credentials must never appear in:

- command arguments
- logs
- TUI transcript
- MCP result metadata
- Evidence Packs
- generated docs/examples
- debug output except in redacted form

## Foundation PR 1 checklist

- [ ] command contracts classify side effects
- [ ] MCP compatibility set is pinned
- [ ] CLI help does not expose secrets or provider credentials
- [ ] stdout/stderr behaviour is tested
- [ ] no new shell execution path is introduced
- [ ] docs do not claim unbuilt graph, vector, corpus, or provider features
```

- [ ] **Step 3: Update `README.md` with links**

Add a short section near existing CLI/module documentation:

```markdown
## CLI foundation and compatibility

jurisd keeps the MCP server as the compatibility surface while the CLI is being reorganised around task-oriented command contracts.

- CLI guide: [docs/CLI.md](docs/CLI.md)
- MCP compatibility reference: [docs/MCP-COMPATIBILITY.md](docs/MCP-COMPATIBILITY.md)
- Security and authority model: [docs/SECURITY-AUTHORITY.md](docs/SECURITY-AUTHORITY.md)

Existing flat CLI commands remain available during the foundation work.
```

- [ ] **Step 4: Verify docs**

```bash
grep -q "Foundation PR 1" docs/CLI.md
grep -q "MCP exposure is curated" docs/SECURITY-AUTHORITY.md
grep -q "CLI foundation and compatibility" README.md
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit Task 6**

```bash
git add docs/CLI.md docs/SECURITY-AUTHORITY.md README.md
git commit -m "docs: add CLI foundation and authority guides"
```

---

## Task 7: Final integration tests and full verification

**Files:**

- Modify only files needed to fix failures found during verification.

- [ ] **Step 1: Run focused unit tests**

```bash
npx vitest run \
  src/test/unit/command-contracts.test.ts \
  src/test/unit/mcp-compatibility.test.ts \
  src/test/unit/cli-help.test.ts \
  src/test/unit/cli.test.ts \
  src/test/unit/tool-surface.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: TypeScript build succeeds and `dist/` is generated.

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Run lint and format check**

```bash
npm run lint
npm run format:check
```

Expected: both pass.

- [ ] **Step 5: Manual CLI smoke checks**

After build:

```bash
node dist/index.js help
node dist/index.js help search-cases
node dist/index.js search-cases "native title" --limit 1
node dist/index.js get-provision
```

Expected:

- `help` prints top-level help to stderr and exits 0.
- `help search-cases` prints command help to stderr and exits 0.
- `search-cases` runs through existing behaviour. Network/source failures are acceptable if represented by existing error handling.
- `get-provision` with no args exits 2 and prints usage or command error.

- [ ] **Step 6: Verify unrelated files remain untouched**

Run:

```bash
git status --short
```

Expected: only intended files are modified. Pre-existing files may still appear:

```text
 M build.sh
?? docs/DOGFOODING.md
?? podman-build.sh
```

Do not stage those files.

- [ ] **Step 7: Commit verification fixes if any**

If fixes were required:

```bash
git add <changed implementation/test/doc files only>
git commit -m "fix: stabilise CLI foundation checks"
```

If no fixes were required, do not create an empty commit.

---

## Task 8: Team leader final review and PR preparation

**Files:**

- No required changes unless final review finds issues.

- [ ] **Step 1: Review commit history**

```bash
git log --oneline origin/$(git branch --show-current)..HEAD
```

Expected: commits are focused and ordered by task.

- [ ] **Step 2: Review diff summary**

```bash
git diff --stat origin/$(git branch --show-current)..HEAD
```

Expected: only Foundation PR 1 files are present. No corpus, graph backend, vector, Isaacus, Evidence Pack, or full TUI implementation appears.

- [ ] **Step 3: Re-run final verification**

```bash
npm run build
npm test
npm run lint
npm run format:check
```

Expected: all pass.

- [ ] **Step 4: Prepare PR body**

Use this body structure:

```markdown
## Summary

- Added command contract foundation for CLI/docs/future adapters.
- Preserved current MCP compatibility surface and pinned it with tests/reference docs.
- Reworked CLI routing/help to derive from command metadata.
- Added repo conventions, CLI guide, and security/authority checklist.

## Scope

This is Foundation PR 1 only. It does not implement corpus storage, vector indexing, graph backends, Isaacus integration, Evidence Packs, completions, or full TUI behaviour.

## Verification

- [ ] npm run build
- [ ] npm test
- [ ] npm run lint
- [ ] npm run format:check

## Compatibility

Existing 15 MCP tool names remain stable. Existing flat CLI commands remain available as compatibility aliases.

## Security notes

- No new shell execution path.
- MCP exposure remains curated.
- Credentials remain configuration-only and are not emitted in docs/examples.
```

- [ ] **Step 5: Open PR when requested by Russ**

Do not push or open a PR unless Russ has asked for it in the execution session.

---

## Self-review notes

Spec coverage:

- Repo conventions covered by Task 1.
- MCP compatibility preservation covered by Task 2.
- Command contract architecture covered by Task 3.
- CLI skeleton and help covered by Tasks 4 and 5.
- Docs skeleton covered by Task 6.
- Security checklist covered by Tasks 1 and 6.
- Full verification covered by Task 7.
- Team leader handoff covered by Task 8.

Intentionally deferred:

- Shell completions, Foundation PR 2.
- TUI scaffold, Foundation PR 3.
- Natural-language agent planner, later PR.
- CorpusStore, source import, vector search, graph backend, Evidence Pack, Isaacus adapters, later stages.

No task should modify the pre-existing unrelated files `build.sh`, `docs/DOGFOODING.md`, or `podman-build.sh`.
