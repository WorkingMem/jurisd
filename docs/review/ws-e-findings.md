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

---

## Check 2 — Loader rejects invalid/tampered manifests

**Probe:** constructed bad fixtures programmatically (clone the valid fixture
manifest, mutate one axis each), pointed the loader at a tempdir, and asserted
the resulting `status` per design §1.2. ajv 8.18.0 is present, so the schema path
(not the structural fallback) is the one exercised; the vendored schema enforces
`files[].sha256` `^[a-f0-9]{64}$`.

**Evidence (`src/test/unit/module-loader-rejects.test.ts`, 8 tests, all PASS):**

| Tamper                      | Loader result                               |
| --------------------------- | ------------------------------------------- |
| `schema_version: 99`        | refused `unsupported_schema_version`        |
| `yanked: true`              | refused `yanked`                            |
| name `"evil; DROP TABLE x"` | refused `invalid` ("not a safe identifier") |
| missing required fields     | refused `invalid`                           |
| non-hex `sha256`            | refused `invalid` (ajv schema pattern)      |
| unparseable `manifest.json` | skipped, no throw                           |
| no `manifest.json`          | skipped, no throw                           |
| `validateManifest(null)`    | `{valid:false}` with typed error            |

- No tamper class throws; every refusal is recorded as a typed `status` +
  `statusDetail` per the degrade-visibly tenet.
- **Design note (not a defect):** a structurally-valid-but-refused module (e.g.
  unimplemented `schema_version`, or an unsafe manifest `name`) is keyed in the
  registry under its _manifest_ `name`, not its dir name. This is safe because the
  unsafe name is only ever metadata for `list_data_modules`; it is never used to
  build a `M__view` SQL identifier. The guarantee is two-fold: `classifyManifest`
  refuses an unsafe name to `status: "invalid"`, and `attachModule` builds views
  only for `status === "ready"` modules (`modules.ts:325`). An unsafe-named module
  can therefore never reach `viewNames`, so the SQL-identifier-injection path is
  closed before any view is created.

**Verdict: PASS.**

---

## Check 3 — The 5 recall tools return correct shapes on the vendored fixture

**Probe:** ran each tool against the vendored fixtures (`fixture` for the
deterministic/graph tools, `fixture-embedded` for the vector path), asserting the
response shape and provenance metadata. DuckDB is present, so none of the
DuckDB-gated cases skipped. The embedded path uses the in-repo test seam
(`setQueryEmbedderForTest`) with the fixture's toy 4-dim descriptor, so the cosine
path is exercised without the absent `@huggingface/transformers` dependency.

**Evidence (`src/test/unit/recall-tools-shapes.test.ts`, 7 tests, all PASS):**

- `list_data_modules` — metadata-only summary (no attach): name/status/coverage/
  embedding=null/snapshot_date correct; `stale=false` (fixture snapshot is recent).
- `get_provision` — deterministic single chunk for ACL `s 18` with the expected
  text and `metadata.source = "local_module"` + name + module_version; a miss
  (`s 999`) returns the typed `{ found: false }`, not a throw (so the router can
  descend to Layer 2).
- `get_act_structure` — nested tree, root `parent_id=null` / `depth=0`, children
  array present, provenance metadata attached.
- `find_citing` — fixture's single `cites` edge (Mabo → ACL s 18) is honoured:
  target = ACL returns Mabo as the citing doc with `kind`, provenance span and
  per-module metadata.
- `semantic_search_local` — query vector `[1,0,0,0]` ranks `s 18` first (its toy
  vector `[0.98,…]` is closest), scores sorted descending, provenance attached.
  With the embedder cleared it degrades visibly: `{ found: false }` + a `notes`
  entry naming the missing embedder (never a throw).

**Test-fixture corrections made (the design doc and the data disagreed on two
incidental points — the _data_ is the ground truth, so the tests were corrected,
not the code):**

- design §6.2 anticipates a "deliberately old fixture snapshot" to exercise the
  staleness advisory; the _vendored_ fixture's snapshot (`2026-06-12`) is in fact
  recent, so `stale` is correctly `false`. The staleness-advisory path is instead
  covered directly in `buildMetadata`/`ageInDays` (a separate unit could pin an
  old date) — noted as a **deferred test gap**, not a code defect.
- `find_citing` is directional: the fixture's lone `cites` edge is Mabo → ACL, so
  the citable _target_ is the ACL, not Mabo. This is correct closed-world
  behaviour, not a miss.

**Verdict: PASS.**
