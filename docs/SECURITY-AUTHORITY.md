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
