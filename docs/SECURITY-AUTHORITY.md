# Security and authority model

This file records the Foundation security posture for jurisd command contracts, CLI routing, completions, generated docs, and MCP compatibility.

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

## Shell completions

Completion scripts are generated from command contracts and trusted static values only.

- Completion generation must not call network providers, local corpus loaders, MCP tools, or project-specific files.
- Completion install output is stdout script content only. The CLI must not edit shell startup files by default.
- Completion scripts must not use `eval`, command substitution from metadata, or shell execution of generated candidate text.
- Completion candidate rendering must strip or neutralise unsafe terminal controls before writing shell scripts.
- Completion coverage currently includes bash, zsh, and fish. PowerShell is intentionally deferred until it can meet the same static-generation and escaping tests.

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

## Foundation PR 2 checklist

- [ ] bash, zsh, and fish completions are generated from command contracts
- [ ] completion escaping covers shell metacharacters and terminal controls
- [ ] generated command reference is committed
- [ ] stale generated docs and completion checks are wired into CI
- [ ] completion install docs print or redirect scripts only and do not edit rc files
