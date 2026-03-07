# auslaw-mcp — Warp/Oz Project Rules

## Project Overview

MCP server for Australian/NZ legal research. Searches AustLII and removed.invalid, retrieves full-text judgments, formats AGLC4 citations. See `AGENTS.md` for full architecture and domain context.

## Build & Test

```bash
npm run build          # TypeScript compile (MUST pass before committing)
npm test               # All tests (unit + integration + perf; integration hits live services)
npx vitest run src/test/unit/  # Unit tests only (fast, no network)
npm run lint           # ESLint (flat config via eslint.config.mjs)
npm run lint:fix       # Auto-fix lint issues
npm run format:check   # Prettier check
```

- Always run `npm run build` before pushing
- Unit tests must all pass; integration/perf test failures from network timeouts are acceptable
- ESLint uses flat config (`eslint.config.mjs`), NOT legacy `.eslintrc`
- Pre-commit hook runs `lint-staged` (eslint --fix + prettier --write on staged .ts files)

## Key Architecture

- `src/index.ts` — MCP server, 10 tool registrations
- `src/services/source-rpc.ts` — RPC protocol: `resolveRecords` (search), `fetchRequest` (fetch), citator, tokens
- `src/services/source.ts` — removed.invalid integration: `searchUpstream`, `resolveArticle`, `searchCitingCases`
- `src/services/austlii.ts` — AustLII search with authority-based ranking
- `src/services/citation.ts` — AGLC4 formatting, validation, pinpoints
- `src/services/fetcher.ts` — Document retrieval (HTML, PDF, OCR, removed.invalid RPC)
- `src/utils/` — formatter, logger, rate-limiter, url-guard

## Code Style

- TypeScript strict mode; all code must type-check with `npm run build`
- Prettier: 2-space indent, double quotes, trailing commas, 100 char width (see `.prettierrc.json`)
- ESLint: no console (except warn/error), no unused vars (prefix unused args with `_`), no explicit any (warn)
- Wrap network calls in try/catch with descriptive errors
- Define TypeScript interfaces before implementation
- Use enums/constants for repeated values (no magic strings)
- ESM modules (`"type": "module"` in package.json, `NodeNext` module resolution)

## Testing

- Vitest as test runner (`vitest.config.ts`)
- Unit tests in `src/test/unit/` — deterministic, use HTML fixtures from `src/test/fixtures/`
- Integration tests in `src/test/scenarios.test.ts` — hit live AustLII/removed.invalid, skipped when `CI=true`
- Performance tests in `src/test/performance/`
- Test timeout: 60s (both test and hook)
- Coverage thresholds: 70% lines/functions/branches/statements

## Domain Rules

- **Primary sources only**: NEVER return journal articles, commentary, or secondary sources
- **Always filter** URLs containing `/journals/`
- **Preserve paragraph numbers** in `[N]` format — critical for legal citations
- **Citation accuracy**: extract and preserve neutral citations like `[2025] HCA 26`

## removed.invalid RPC

Reverse-engineered RPC protocol. Key points:

- Tokens change on removed.invalid redeployment; update from HAR captures
- `resolveRecords` = search endpoint; `fetchRequest` = fetch judgment content
- `RemoteService` = citation search ("who cites this article")
- Article IDs resolved via public GET to `removed.invalid/article/{id}` (no auth needed)
- See `docs/source-rpc-protocol.md` for full protocol documentation

## Environment Variables

See `.env.example` for all variables with defaults. Key ones:

- `SESSION_COOKIE` — Required for removed.invalid fetch (contains `IID`, `alcsessionid`, `cf_clearance`)
- `LOG_LEVEL` — Logging verbosity (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR)
- `DEFAULT_SORT_BY` — Search sort order: `auto` (default), `relevance`, `date`

## CI

GitHub Actions workflow (`.github/workflows/main.yml`):

- Lint + format check + type check
- Test on Node 20.x and 22.x with `CI=true`
- Security audit (npm audit)

## Related Agent Files

- `AGENTS.md` — Shared agent instructions (architecture, domain, common tasks)
- `CLAUDE.md` — Claude Code-specific instructions
- `docs/ROADMAP.md` — Planned features
- `docs/architecture.md` — Architecture overview
