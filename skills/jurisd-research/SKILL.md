---
name: jurisd-research
description: Expert Australian/NZ legal research and AGLC4 citation using the jurisd MCP server. Use when finding cases or legislation (AustLII/jade.io), looking up a provision offline, formatting or resolving citations, building a pinpoint, tracing who-cites-what, or producing an AGLC4 bibliography. Triggers on case law, legislation, "AGLC4", "pinpoint", "citator", "cited by", "bibliography", neutral citations like "[1992] HCA 23", or jurisdiction codes (cth/vic/nsw/qld/sa/wa/tas/nt/act/nz).
---

# jurisd: Australian/NZ legal research

jurisd is an MCP server for AU/NZ legal research. It searches AustLII (with jade.io
citation enhancement at runtime), fetches full-text judgments, formats AGLC4 citations, manages a
local citation cache + bibliography, and serves offline recall from installed data
modules. There are **15 tools**; operation variants are picked via a
`mode`/`op`/`action`/`by` discriminator, not separate tools.

## Core rule: local first, live as fallback

When data modules are installed (check with `list_data_modules`), prefer the offline
tools for deterministic, citable, no-network answers. Fall through to live tools when
the module misses or no module is installed. The local tools return a typed not-found
so you can tell a genuine miss from an error.

| Need                               | Local first (offline)   | Live fallback                                       |
| ---------------------------------- | ----------------------- | --------------------------------------------------- |
| Read a specific provision (`s 18`) | `get_provision`         | `search_legislation` → `fetch_document_text`        |
| Act outline / structure            | `get_act_structure`     | `search_legislation` → `fetch_document_text`        |
| Who cites this case                | `find_citing`           | `search_citing_cases` (needs `JADE_SESSION_COOKIE`) |
| Concept / natural-language recall  | `semantic_search_local` | `search_cases` / `search_legislation`               |

Always check `list_data_modules` once at the start of a research session so you know
which layer to lead with. Every local answer carries `metadata.source = "local_module"`
with module name, version, and snapshot date; mind the staleness advisory.

## The 15 tools

### Live research

- **`search_cases`** — NL case-law search across all AU/NZ jurisdictions (AustLII,
  authority-ranked; jade.io citation data cross-referenced into results at runtime). `method`: auto/title/phrase/all/any/near/boolean;
  `jurisdiction`; `sortBy` auto/relevance/date; `offset` for pagination.
- **`search_legislation`** — same controls for legislation (`method` adds `legis`).
- **`fetch_document_text`** — full text from an AustLII or jade.io URL (HTML, PDF via
  pdf-parse, jade.io GWT-RPC). Pass `citeKey` to also save a local source copy + freshness headers.

### Citation + bibliography (AGLC4)

- **`resolve_citation`** — citation/case-name → authoritative source. `mode`: `auto`
  (validate neutral cite vs AustLII, else text search), `validate` (existence check
  only), `search` (text only).
- **`format_citation`** — AGLC4 formatter. `mode`: `full` (default), `short`, `ibid`,
  `subsequent` (needs `footnoteRef`), `pinpoint` (fetches a judgment and locates a para).
- **`jade_lookup`** — jade.io lookup. `by`: `article_id` (resolve metadata) or
  `citation` (build a lookup URL; jade.io has no public search API).
- **`search_citing_cases`** — live jade.io citator (who cites X). Needs
  `JADE_SESSION_COOKIE`. Returns a sample (~20-30) plus `totalCount`.
- **`cite`** — write to the local cache. `action`: `add` (default; assigns a biblatex
  cite key, returns AGLC4 string) or `refresh_source` (conditional-HEAD freshness check).
- **`bibliography`** — read the cache (no network). `op`: `get`, `list` (default),
  `export` (writes a `.bib`), `cited_by`.
- **`cache_cited_by`** — fetch + store a cached citation's citing cases from jade.io
  (needs `JADE_SESSION_COOKIE`); downloads top-N sources. Populates `bibliography op=cited_by`.

### Local data modules (offline)

- **`get_provision`** — deterministic single-provision lookup (no embedding/ranking).
- **`get_act_structure`** — containment tree (Act → Part → Division → section/sched/clause).
- **`find_citing`** — offline citator twin, with each citation's provenance span.
  `kinds`: `cites`/`considers` (considers = stronger substantive engagement).
- **`semantic_search_local`** — local vector recall (bge-small, offline, no key);
  optional `filter` on jurisdiction/type/segment_type; `k` results.
- **`list_data_modules`** — introspect installed modules (coverage, counts, embedding
  descriptor, load status, snapshot, staleness). `includeInvalid` shows refused modules.

## Decision guidance

- **`resolve_citation` vs `search_cases`**: if you already have a citation or a precise
  case name, use `resolve_citation` (it validates the neutral cite and hands back the
  canonical URL). Use `search_cases` for open-ended topic discovery.
- **`find_citing` (local) vs `search_citing_cases` (live)**: lead with `find_citing`
  when a module covers the area — it is offline, deterministic, and gives provenance
  spans. Use `search_citing_cases` for live, jade.io-wide coverage; it needs a session
  cookie and returns only a sample of the full set.
- **`get_provision` vs `search_legislation`**: a known provision (`s 18`, `sch 2`,
  `reg 12`, `cl 4(1)`) → `get_provision`. On a typed not-found, fall through to
  `search_legislation` then `fetch_document_text`.
- **`semantic_search_local` vs `search_cases`/`search_legislation`**: concept questions
  over installed corpora → `semantic_search_local`. Anything outside module coverage, or
  needing live/recent material → the live search tools.

## AGLC4 citation workflows

`format_citation` modes:

- **full** (default) — combine `title` + `neutralCitation` + `reportedCitation` +
  optional `pinpoint`. `style`: `combined` (default), `neutral`, or `reported`.
  e.g. `Mabo v Queensland (No 2) [1992] HCA 23 (1992) 175 CLR 1`.
- **short** — short form using the abbreviated `title` chosen at first reference
  (e.g. `Mabo`); add `pinpointPara` or `pinpointPage`.
- **ibid** — back-to-back same source (`Ibid`), optionally with a new pinpoint.
- **subsequent** — `title (n X)` referring back to footnote `footnoteRef`.
- **pinpoint** — give a `url` (AustLII) plus a `paragraphNumber` **or** `phrase`; jurisd
  fetches the judgment and returns the located paragraph pinpoint. Add `caseCitation` to
  prepend the case citation to the pinpoint string.

Bibliography export: `bibliography op=export` writes a BibLaTeX `.bib` (defaults to
`<cacheDir>/<projectName>.bib`, override with `outputPath`) and returns the bib text.
Filter to one logical document with `document`. List/inspect with `op=list` / `op=get`.

## Typical research flow

1. **Orient** — `list_data_modules` to see offline coverage.
2. **Find authority** — `search_cases` (topic) or `resolve_citation` (known cite/name);
   for a provision, `get_provision` first, else `search_legislation`.
3. **Verify** — `resolve_citation mode=validate`, or read with `fetch_document_text`.
4. **Pinpoint** — `format_citation mode=pinpoint` (url + paragraphNumber/phrase).
5. **Cache** — `cite action=add` to record the source and get a cite key + AGLC4 string;
   optionally `cache_cited_by` to pull who-cites-it (or `find_citing` offline).
6. **Bibliography** — `bibliography op=export` to emit the `.bib`.

## Module management

- Discover/inspect installed modules: **`list_data_modules`** (`refresh` to rescan,
  `includeInvalid` to see refused ones and why).
- Install modules out-of-band via the **CLI** (kept off the tool surface so an LLM never
  triggers a large download mid-conversation):

  ```bash
  jurisd fetch-module <name> [--modules-dir DIR]   # download + sha256-verify + atomic install
  jurisd verify-module <name> [--modules-dir DIR]  # re-verify installed files vs manifest
  jurisd list-modules [--modules-dir DIR]          # list installed (incl. refused)
  ```

  `legislation-cth` is published as `workingmem/legislation-cth` on Hugging Face. It
  provides Commonwealth primary and secondary legislation, citation edges, unmatched
  citations, and local bge-small embeddings. `fetch-module` downloads the manifest and
  parquet files, verifies each file against the manifest sha256 values, and installs the
  module atomically.

  Advanced operators can pass `--manifest-url URL` only for an explicitly trusted
  manifest source. The sha256 checks prove files match that manifest; they do not prove
  the manifest's provenance.

  Install root defaults to `~/.jurisd/modules/` (override `JURISD_MODULES_DIR`). Local
  tools need optional `@duckdb/node-api`; `semantic_search_local` also needs
  `@huggingface/transformers`. Pin a specific module with the `module` arg on any recall tool.

## BYOK note

All env vars are optional — with none set, both the live AustLII layer and local
baseline recall work. `semantic_search_local`'s **baseline** (pure local cosine, no
key, no network) is always present. A **domain-specialised** rerank / extractive-QA slot
activates only if a provider key is set **and reachable** (e.g. `ISAACUS_API_KEY`); it
refines the local top-k, never replaces it, and silently degrades to baseline when the
key is unset or unreachable (reported by the capability probe, never thrown in a result).
`search_citing_cases` and `cache_cited_by` need `JADE_SESSION_COOKIE`; without it, prefer
the offline `find_citing`.

## Gotchas

- Live tools hit the network and can be slow/flaky; prefer offline tools when a module covers the area.
- `search_citing_cases` returns a **sample**, not the full set — read `totalCount`.
- For short/ibid/subsequent forms, `title` is the **abbreviated** name picked at first reference, not the full case name.
- `pinpoint` mode needs an AustLII `url` with paragraph blocks; if none are found it returns an error rather than guessing.
