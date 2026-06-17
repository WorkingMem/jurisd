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

| Group    | Purpose                                                    | Status                                  |
| -------- | ---------------------------------------------------------- | --------------------------------------- |
| `search` | Search cases, legislation, citations, and local modules    | Foundation metadata only                |
| `cite`   | Resolve, format, cache, and list citations                 | Foundation metadata only                |
| `corpus` | Inspect local modules and future corpora                   | Foundation metadata only                |
| `graph`  | Future relationship tracing and closed-world graph queries | Not implemented                         |
| `review` | Future review-state workflow                               | Not implemented                         |
| `enrich` | Future provider-backed enrichment jobs                     | Not implemented                         |
| `export` | Future source-backed exports and Evidence Packs            | Not implemented                         |
| `mcp`    | MCP server and compatibility inspection                    | Partially implemented by server startup |
| `doctor` | Future capability and degradation diagnostics              | Not implemented                         |
| `tui`    | Future terminal workbench                                  | Not implemented in Foundation PR 1      |

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

| Code | Meaning                              |
| ---: | ------------------------------------ |
|    0 | success                              |
|    1 | general failure                      |
|    2 | usage or validation error            |
|    3 | no results                           |
|    4 | source unavailable                   |
|    5 | auth failure                         |
|    6 | network failure                      |
|    7 | parse or citation resolution failure |
|    8 | partial success                      |
|    9 | unsafe operation refused             |
|   10 | configuration error                  |
|   11 | internal error                       |
|  130 | interrupted                          |
