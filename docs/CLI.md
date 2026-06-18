# jurisd CLI guide

jurisd is a source-backed Australian legal research tool with MCP integration and a growing CLI surface.

This guide documents the Foundation CLI shape. It does not claim corpus import, vector search, graph traversal, Evidence Pack export, Isaacus integration, or agentic TUI functionality is implemented yet.

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

## Generated command reference

The detailed command reference is generated from the command contract registry:

- [generated command reference](generated/COMMANDS.md)
- [bash completion](generated/completions/jurisd.bash)
- [zsh completion](generated/completions/jurisd.zsh)
- [fish completion](generated/completions/jurisd.fish)

Regenerate and check these files with:

```bash
npm run generate:commands
npm run check:generated
```

## Shell completions

Completion scripts are generated from static command metadata. They do not call the network, read project files, execute providers, or edit shell startup files.

Print the completion script for a supported shell:

```bash
jurisd completion bash
jurisd completion zsh
jurisd completion fish
```

Install by redirecting the printed script into a shell-managed completion location, for example:

```bash
jurisd completion bash > ~/.local/share/bash-completion/completions/jurisd
jurisd completion zsh > ~/.zfunc/_jurisd
jurisd completion fish > ~/.config/fish/completions/jurisd.fish
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
| `tui`    | Inline terminal workbench scaffold                         | WB3 scaffold implemented                |

## TUI scaffold

```bash
jurisd tui
```

The WB3 scaffold is an inline transcript/composer surface over the command
contract registry. It accepts slash commands such as:

```text
/commands
/corpus.listDataModules
/list-data-modules
/quit
```

Slash commands resolve through governed command ids or CLI aliases. The WB3
scaffold only dispatches contracts that are explicitly TUI-enabled and limited
to local/read-only side effects; those commands run through the same in-process
loopback used by the CLI.

Terminal framework decision: WB3 deliberately uses Node readline rather than a
fullscreen TUI framework. The scaffold must run under `TERM=dumb`, narrow
terminal widths, and CI pseudo-terminal smoke tests before later PRs introduce
stateful panes or richer rendering.

The source, corpus, graph, review, enrichment, and export panes remain inert
placeholders until their workbench items land. The scaffold does not claim
agentic drafting, corpus import, graph traversal, or Evidence Pack export.

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
- Search commands return a JSON array only when the search coverage is complete.
  If a source degrades or configured coverage is unavailable, JSON output returns
  `{ "results": [...], "warnings": [...], "sources": { ... }, "degraded": true }`
  and the CLI exits 4.

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
