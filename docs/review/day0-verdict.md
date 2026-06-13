# Day-0 Readiness Verdict

**Verdict: APPROVED WITH NOTES.** jurisd is ready for day-0 public exposure. The
build is clean, the MCP stdio handshake lists exactly the documented 15 tools, the
unit suite is green, and the docs honestly state that data-module publishing is
still pending. No blocking issues found.

Two known-pending, non-blocking items are tracked under "Known pending" below;
both are already documented honestly in the user-facing docs (degrade-visibly),
so neither blocks a day-0 release of the server itself.

## Scope

This is a fast re-verification of the headline claims, not a full re-audit. The
full clean-clone walkthrough (clone, install, build, MCP handshake, Docker, skill
validation) was performed by the predecessor reviewer and committed as
`9e86503` ("fix(docs): day-0 walkthrough corrections"); that reviewer died on a
network error before recording its verdict. This document re-verifies the load-
bearing claims and records the verdict durably.

## What was verified

- **Walkthrough corrections (`9e86503`) reviewed.** The diff replaces dead
  `jurisd-data` links and "is published" framing with an honest "module
  publishing in progress / no modules available yet" status across `README.md`,
  `docs/INSTALL.md`, and `skills/jurisd-research/SKILL.md`. The corrections are
  accurate: they state the live AustLII + citation layer runs standalone while the
  five local-recall tools degrade visibly to "no modules".

- **Build passes.** `npm run build` (tsc + manifest-schema copy) completes with no
  errors.

- **MCP stdio handshake reports 15 tools.** `node scripts/docker-handshake.mjs --
node dist/index.js` drove the JSON-RPC `initialize` + `tools/list` exchange and
  asserted the count. Result: `server: jurisd v0.1.0`, `OK: 15 tools listed`. The
  15: bibliography, cache_cited_by, cite, fetch_document_text, find_citing,
  format_citation, get_act_structure, get_provision, source_lookup,
  list_data_modules, resolve_citation, search_cases, search_citing_cases,
  search_legislation, semantic_search_local. This matches `src/server.ts` and
  `CLAUDE.md`.

- **Test suite passes.** `npx vitest run src/test/unit/` — 37 test files, 615
  passed, 1 skipped, 0 failed (44.9s). Unit suite is the gating set; integration/
  perf tests hit live services and flake on network per project policy.

- **Zero free/premium/freemium framing.** Grep sweep across `*.md`/`*.ts`/`*.json`
  found only legitimate references: CHANGELOG history recording the terminology
  audit, design/architecture docs documenting the _absence_ of tier framing, the
  WS-E findings record, and `src/test/unit/capabilities-adapter.test.ts` which
  asserts no free/premium framing ever appears. No actual freemium/upsell framing
  in user-facing copy.

- **Zero stale `auslaw-mcp` refs outside history.** Grep sweep found `auslaw-mcp`
  only in `CHANGELOG.md` (the legitimate rename record) and in `coverage/` build
  artifacts (transient, not source/docs). No stale references in source, docs,
  skills, or CI config.

- **fetch-module docs state the release is pending honestly.** README, INSTALL,
  `skills/jurisd-research/SKILL.md`, and `docs/DOCKER.md` all carry a clear
  "publishing in progress / no modules available yet / `fetch-module` fails fast
  with a 404" status, and explain the server runs fully without any module.

## Known pending (non-blocking)

- **`legislation-cth` (and other `jurisd-data`) release assets pending.** The
  `jurisd-data` publishing repo and its first GitHub release are still being built,
  so `jurisd fetch-module` currently resolves a release URL that 404s. This is
  expected pre-publish and is documented honestly in user-facing docs. The server
  runs standalone (live AustLII + citation layer); the five local-recall tools
  degrade visibly to "no modules". Not a blocker for shipping the server.

- **npm publish decision pending HITL.** Whether/when to `npm publish` jurisd
  (currently `0.1.0`) is a human decision and is not part of this day-0 server
  readiness verdict.

## Blocking issues

None.
