# cite-check

Standalone Bun/TypeScript script that scans pandoc-flavored markdown drafts
for citations, queries NotebookLM via the `nlm` CLI to verify each citation
against the cited source, and writes a structured `REVIEW-CITES.md` report
classifying claims as SUPPORTED / PARTIAL / UNSUPPORTED / NOT_IN_NOTEBOOK /
ERROR.

## CAVEAT

This was extracted from `librarian-cli` on 2026-04-24 as a self-contained
copy. It hasn't been wired into the `nlm` skill's frontmatter or packaged as
an installable command — that's a follow-on task. The code is dropped here so
it isn't lost when the cite-check work was reverted out of `librarian-cli`.
Some touch-up may be needed before it's used in production (e.g. confirming
the import paths still resolve under your Bun version, adjusting the default
nlm binary path).

## How to run

```bash
bun ~/projects/workflows/skills/nlm/cite-check/cite-check.ts \
    --drafts <dir> \
    --notebook <notebook-id> \
    [--out <path>] \
    [--limit N] \
    [--rate-ms 1500] \
    [--dry-run] \
    [--debug]
```

Flags:

- `--drafts <dir>` — directory containing `.md` drafts (default: `./drafts`)
- `--notebook <id>` — required. The NotebookLM notebook id whose sources
  carry one item per bibkey (titles must equal bibkeys for matching).
- `--out <path>` — output report path (default: `<drafts>/REVIEW-CITES.md`)
- `--limit N` — only check the first N citations (useful for smoke tests)
- `--rate-ms <n>` — sleep between successive NLM calls (default 1000 ms)
- `--dry-run` — print the prompts that would be sent, without calling NLM
- `--debug` — verbose tracing to stderr

The script shells out to `~/.local/bin/nlm` by default. Each call uses
`nlm sources <id>` (once, up front) and `nlm generate-chat <id> <prompt>
--format plain`.

## Logic

### Bibkey matching

Citations whose bibkey doesn't match any source title in the notebook are
tagged `NOT_IN_NOTEBOOK` without consuming an NLM call. Source titles are
compared exactly to `[@bibkey]` strings — so when adding sources via `nlm
add`, set the title to the bibkey for cite-check to find them.

### Pandoc citation forms supported

- `[@bibkey]` — single bracketed
- `[@bibkey, p. 42]` — with locator
- `[@a; @b, p. 5]` — multi-cite (split into separate citations)
- `@bibkey` — in-text citation
- Pandoc-crossref anchors (`[@tbl:foo]`, `[@fig:x]`, `[@sec:y]`, `[@eq:z]`,
  `[@lst:w]`) are silently skipped — they aren't real citations.

### Footnote indirection

Pandoc footnote definitions look like:

```markdown
Body sentence with marker.[^id]

[^id]: footnote body text [@bibkey, p. 42].
```

When a citation is found inside a `[^id]:` definition, cite-check walks the
markdown for the matching `[^id]` body marker and uses the sentence
containing that marker as the `claim`. The footnote body itself is carried as
`footnoteContext` in the prompt. Orphan footnotes (no body marker) fall back
to the footnote body as the claim.

### Bluebook signals

When a Bluebook signal precedes the cite (e.g. `See [@key]`, `Cf. [@key]`,
`See, e.g., [@key]`, `*See* [@key]`, `But see [@key]`, etc.), the prompt is
softened: instead of asking whether the source supports the verbatim body
sentence, it asks whether the source generally supports or relates to the
proposition. Conceptual alignment is sufficient. The detected signal is
attached to the prompt and surfaced in the report column as `[see]` /
`[cf.]` / etc.

Recognized signals (case-insensitive, optional `*`/`_` emphasis): `see`,
`see also`, `see generally`, `see, e.g.,`, `cf.`, `compare`, `accord`,
`but see`, `but cf.`.

### Parentheticals

A parenthetical immediately following a cite (allowing whitespace, including
a single newline) becomes the `claim`. The body sentence is demoted to
`bodyContext` and included in the prompt as supplemental context. Examples:

- `Body sentence [@key] (showing X).` → claim is `showing X`,
  bodyContext is the body sentence.
- `[@key, p. 42] (quoting Smith).` → claim is `quoting Smith`, locator
  is `p. 42`.
- Multi-cite: `[@a; @b] (collectively, on point).` → both cites share the
  parenthetical claim.

When a signal AND a parenthetical are both present, both are honored: the
prompt is softened (signal) and uses the parenthetical as the claim.

### Retry-on-empty

`nlmGenerateChat` retries up to 3 times (immediate + 1s + 2s backoff) on
either nonzero exit or empty stdout. After all retries fail, the citation is
tagged `ERROR` in the report (rather than silently producing a `PARTIAL`
classification on whitespace).

## Files

- `cite-extract.ts` — pure-function pandoc citation extractor (no I/O,
  no external deps). Exports `extractCitations(markdown, filePath) →
  Citation[]`.
- `nlm.ts` — NotebookLM CLI wrapper using `Bun.spawn`. Exports
  `nlmGenerateChat`, `nlmListSources`, `parseNlmSourcesTable`, and a test
  seam `__setNlmSpawnerForTesting`.
- `cite-check.ts` — the standalone CLI. Imports the two above, parses argv,
  walks drafts, runs prompts, writes the report.
- `tests/cite-extract.test.ts` — unit tests for the extractor (footnotes,
  signals, parentheticals, crossref filter, multi-cite splits).
- `tests/nlm.test.ts` — unit tests for the table parser and retry logic
  (uses the test-seam spawner).

## Testing

```bash
cd ~/projects/workflows/skills/nlm/cite-check
bun test
```

Tests are pure — no live NLM calls. The retry tests use the
`__setNlmSpawnerForTesting` seam to inject canned responses.

## Origin

Extracted from these librarian-cli commits (preserved on the
`cite-check-archive` branch in `~/projects/librarian-cli`):

- `7d2ff71` — feat: add cite-check command (initial)
- `921e2a0` — cite-check: footnote indirection + pandoc-crossref filter
- `44dd43c` — cite-check: retry on empty/error + ERROR status tag
- `24d6bd6` — cite-check: detect Bluebook signals + extract parentheticals
