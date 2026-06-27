# Roadmap

This roadmap tracks forward work only. Delivered architecture and command
surface details live in the focused reference docs:

- [Architecture](ARCHITECTURE.md)
- [Install guide](INSTALL.md)
- [CLI guide](CLI.md)
- [MCP compatibility](MCP-COMPATIBILITY.md)
- [Security and authority model](SECURITY-AUTHORITY.md)
- [Agent guide](AGENT-GUIDE.md)

## Current Product State

jurisd is a pre-1.0 Australian and New Zealand legal research tool with:

- MCP tools for live AustLII search, source fetching, citation formatting, and bibliography work.
- Local data-module plumbing for deterministic provision lookup, local semantic recall, and citation graph traversal.
- CLI parity for the current MCP tool surface.
- Day-0 packaging, Docker, and install documentation.

The main product gap is not another historical implementation phase. It is
turning the existing engine into a governed workbench with reviewable source
custody, offline data modules, and operator-safe workflows.

## Workstreams

### 1. First Public Data Module

Deliver the first redistributable data module and make module install behaviour
observable end to end.

- Publish the first public baseline module.
- Verify manifest validation, file hash checks, and atomic install from a clean clone.
- Keep non-redistributable sources recipe-only.
- Document exact operator commands once a module is available.

Review artefact: fresh-clone module install, verify, list, and one local recall
query against the published module.

### 2. CLI/TUI Reasoning Workbench

Build the research workbench on top of the governed command contracts.

- Keep command contracts as the single source for CLI help, generated references, and shell completions.
- Add the TUI scaffold without weakening MCP compatibility.
- Introduce authority-aware execution and typed result blocks.
- Add source custody, fixture corpus import, lexical recall, semantic recall, and graph traversal over a closed corpus.
- Add review workflow, evidence pack export, and curated MCP workbench tools.

Review artefact: a functional CLI/TUI workflow that imports a fixture source,
runs recall, shows source-backed results, and exports a reviewable evidence pack.

### 3. Public Documentation Hygiene

Keep public documentation product-facing and safe.

- Remove internal planning artefacts, stale build logs, and private local conventions.
- Keep contact and security reporting metadata consistent.
- Consolidate overlapping docs into a small set of maintained guides.
- Avoid publishing workflow codenames as user-facing structure.

Review artefact: docs-only PR with link checks, stale-reference checks, and a
clear before/after navigation surface.

### 4. In-Workflow Module Management

Expose module lifecycle information safely inside the research workflow.

- Surface installed, refused, and available module versions.
- Add approval-gated module fetch/update flows.
- Preserve CLI parity for every in-workflow module operation.
- Keep large downloads and filesystem writes out of unapproved assistant paths.

Review artefact: approval-gated workflow that lists available modules and
requires explicit confirmation before install or update.

### 5. Corpus Coverage Expansion

Expand coverage without weakening licensing and provenance controls.

- Add redistributable state and territory sources where licensing permits.
- Keep restricted sources recipe-only.
- Preserve per-source licence verdicts in module metadata.
- Add source-specific fixtures before promoting a source into a public module.

Review artefact: one new source pipeline with licence verdict, fixtures, module
metadata, and local recall validation.

## Gates

Every roadmap PR must produce a reviewable artefact, not only isolated unit
tests. A PR is ready for human review when:

- The branch has a functional product check tied to the workstream.
- Generated outputs are checked into the repo when applicable.
- CI passes or any live-service failures are clearly isolated and explained.
- Fresh clean-code and security reviews are complete for product-impacting changes.
- The OpenProject work item is moved to the review gate only after the PR is functional.
