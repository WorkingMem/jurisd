# Agent instructions for jurisd

## Purpose

jurisd is a source-backed Australian legal research and provenance instrument over a governed command surface. It exposes legal research capabilities through MCP, CLI, and future TUI adapters.

Do not describe jurisd as a chatbot, oracle, AI companion, or autonomous legal advice system.

## Current foundation architecture

Current files:

- `src/server.ts` registers the current MCP tool surface.
- `src/cli.ts` handles CLI entry before the server starts.

Foundation PR 1 is introducing planned command-surface governance files:

- `src/commands/types.ts` will define command contract and authority metadata types.
- `src/commands/contracts.ts` will provide the command contract registry for CLI/docs/future adapters.
- `docs/MCP-COMPATIBILITY.md` will record the MCP compatibility set once present.

## Command contract rule

Foundation PR 1 is introducing the command contract registry. Once present, add commands once through that registry.

Every public command contract needs:

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

Until the registry exists, command surface changes must preserve MCP compatibility and update tests and docs together.

## MCP surface rule

MCP tools are curated. Do not expose operator, install, update, destructive, filesystem-write, or network-write commands over MCP unless a later authority decision explicitly permits it.

Existing MCP tool names are compatibility-sensitive. Update `docs/MCP-COMPATIBILITY.md` once present. Before then, update the MCP tool-surface tests before changing the tool surface.

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
