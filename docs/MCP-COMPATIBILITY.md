# MCP compatibility reference

This file records the current jurisd MCP tool surface for Foundation PR 1. The purpose is compatibility protection, not product documentation.

## Compatibility rule

MCP tool names are stable `snake_case` adapter aliases. Do not rename, remove, or add MCP tools without updating this reference, the MCP compatibility test, and release notes.

MCP exposure is curated. Operator, install, update, destructive, filesystem-write, and network-write commands remain CLI-only unless a later authority decision explicitly allows them.

## Current tool set

| Tool                    | Status | Notes                                        |
| ----------------------- | ------ | -------------------------------------------- |
| `bibliography`          | stable | Citation cache bibliography output           |
| `cite`                  | stable | Citation helper                              |
| `fetch_document_text`   | stable | Fetch document text from allowed sources     |
| `find_citing`           | stable | Local module graph recall                    |
| `format_citation`       | stable | AGLC4 citation formatting                    |
| `get_act_structure`     | stable | Local module act structure                   |
| `get_provision`         | stable | Local module provision lookup                |
| `list_data_modules`     | stable | Local module listing                         |
| `resolve_citation`      | stable | Citation resolution                          |
| `search_cases`          | stable | Case search                                  |
| `search_legislation`    | stable | Legislation search                           |
| `semantic_search_local` | stable | Local semantic search over installed modules |

## Verification

The compatibility test is `src/test/unit/mcp-compatibility.test.ts`.

Run:

```bash
npx vitest run src/test/unit/mcp-compatibility.test.ts src/test/unit/tool-surface.test.ts
```

Expected: both tests pass and report exactly 12 registered MCP tools.
