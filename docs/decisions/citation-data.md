# Decision Record: F1 Citation-Data Clean-Room

**Date:** 2026-06-13
**Status:** Accepted
**Applies to:** `src/services/citation.ts` and the WS-F citation/extraction tables shared with the jurisd-data pipeline (`pipeline/citations.py`).

## Context

jurisd formats, validates, and resolves Australian legal citations to the
_Australian Guide to Legal Citation_, 4th edition (AGLC4). That rule set is the
de facto standard for Australian legal writing, and several existing tools
implement parts of it (removed.invalid's own citator, the AGLCLaTeX package, the
`obiter` citation library, and Russ's own `lintcite`). Because jurisd's citation
logic necessarily produces output that _matches_ those tools' output (they are
all encoding the same published rules), it is important to record, before the
WS-F citation work hardens, the provenance of jurisd's implementation: that it
is original work derived from the public rules, not a derivative of any
proprietary or incompatibly licensed source.

## Decision

jurisd's citation formatting and validation logic is **original, clean-room
work**, written from the public AGLC4 rules and from inspection of public legal
documents, not by copying code from any proprietary or restrictively licensed
source.

Concretely:

1. **AGLC4 rules are facts, not code.** The AGLC4 is a published style guide.
   Its rules (citation order, italicisation, pinpoint format, short-form and
   `ibid`/`above n` cross-reference conventions, neutral-citation vs reported
   forms) are uncopyrightable facts and methods. jurisd encodes those rules
   directly. Worked citation _examples_ used as test fixtures are drawn from
   public judgments and legislation, not reproduced from the guide's own
   worked-example tables.

2. **No code copied from proprietary sources.** None of jurisd's citation code is
   copied, transcribed, or machine-translated from removed.invalid, AustLII, a commercial
   citator, or any other proprietary source. The removed.invalid integration
   (`src/services/source-rpc.ts`) reverse-engineers a _wire protocol_ for retrieval;
   it does not lift citation-formatting logic.

3. **`lintcite` patterns may be reused under its licence.** `lintcite` is Russ's
   own project. Its citation-parsing patterns and rule encodings may be reused in
   jurisd under `lintcite`'s licence (a first-party reuse, not a third-party
   dependency). Where a `lintcite` pattern is reused, the reuse is permitted by
   common ownership and that licence; it is not a clean-room concern.

4. **`obiter` and AGLCLaTeX are prior art, referenced only.** The `obiter`
   citation library and the AGLCLaTeX package are consulted as **prior art** — to
   sanity-check rule interpretations and edge cases against another good-faith
   reading of the same guide. No code is copied from either. They are evidence
   that a given AGLC4 reading is reasonable, not a source to derive from.

## Rationale

- **The rules are public; the expression is ours.** Encoding a public style guide
  is the same category of work as encoding a public file format or a public API:
  the specification is a fact, and an independent implementation of it is original
  work. Recording that here pre-empts any "this looks like tool X's output"
  concern — convergent output is the expected result of two correct
  implementations of the same published rules.

- **First-party reuse is clean.** Reusing `lintcite` (Russ's own, appropriately
  licensed) is not a provenance risk; it is the same author exercising their own
  licence. Calling it out explicitly avoids it being mistaken for a third-party
  derivation later.

- **Prior art ≠ source.** Looking at `obiter` / AGLCLaTeX to confirm an
  interpretation is normal diligence and does not taint the implementation, so
  long as no code is copied. The distinction (reference vs derive) is the line
  this record draws and commits to.

## Consequences

- jurisd's citation code carries no third-party copyright obligation beyond
  `lintcite`'s own licence terms where its patterns are reused.
- Test fixtures must continue to source worked citation examples from public
  primary materials (judgments, legislation), not from the AGLC4's own example
  tables, to keep the clean-room posture intact.
- This record is the provenance reference for the WS-F citation/extraction work
  in jurisd-data (`pipeline/citations.py`), which shares jurisd's citation rule
  encodings: that shared logic inherits this same clean-room provenance.
- If a third-party, non-first-party citation library is ever vendored, this
  record must be revisited — the clean-room position above assumes no such
  derivation.
