# WS-E data layer — adversarial review findings

Scope: the landed WS-E data layer (commits `0ecd0b3..9b960f9`), reviewed against
the design contract in [`docs/design/data-layer.md`](../design/data-layer.md).

Each check below records the probe performed, the evidence, and the verdict
(PASS / PASS-with-note / FAIL-then-fixed). Fixes are committed immediately after
the check that found them.

---

## Salvage triage (pre-checks)

- `docs/ARCHITECTURE.md` + `docs/PROJECT-OVERVIEW.md` — modified on disk by the
  2nd reviewer. Inspected the diffs: they correct doc-drift to the landed 15-tool
  surface (10 live/citation + 5 WS-E recall), add the Local Data Layer (WS-E)
  section, and reframe `ISAACUS_API_KEY` as a vendor-neutral BYOK domain-adapter
  slot (baseline ↔ domain-specialised, never free/premium). This matches the
  design contract §4.2 framing rule exactly. **Kept** — committed with Check 1.
- `src/test/unit/_wse_review_scratch*.test.ts` — throwaway probes the 2nd reviewer
  wrote. They exercise the real loader/probe/adapter/tool API. **Logic reused**
  (durable tests derived from them); **scratch files removed** at Check 8.

---

## Check 1 — Tool count: all 15 register, no stale names

**Probe:** built `dist/`, called `createMcpServer()`, enumerated the SDK's
`_registeredTools` map at runtime; also grepped `src/` for stale pre-R5
one-tool-per-operation names.

**Evidence:**

- Runtime enumeration returns exactly **15** tools:
  `bibliography, cache_cited_by, cite, fetch_document_text, find_citing,
format_citation, get_act_structure, get_provision, source_lookup,
list_data_modules, resolve_citation, search_cases, search_citing_cases,
search_legislation, semantic_search_local`.
- 10 base (post-R5) + 5 WS-E (`get_provision`, `get_act_structure`, `find_citing`,
  `semantic_search_local`, `list_data_modules`). No duplicates.
- Grep for stale names (`search_provision`, `provision_lookup`, `act_structure`,
  `data_module`, `module_recall`, `local_search`, `semantic_local`) — no matches
  outside the scratch files.
- Made the invariant durable: `src/test/unit/tool-surface.test.ts` asserts the
  count and the exact name set (2 tests, both PASS).

**Verdict: PASS.**
