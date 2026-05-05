---
name: cite-check
description: "Verify academic citations against source PDFs using Gemini File Search API. Use when 'check citations', 'verify cites', 'cite-check', 'run citation review', 'are my citations grounded', 'does source X support claim Y', 'what does source X say about Y', or validating that pandoc citations in markdown drafts are supported by their source documents."
user-invocable: true
---

# Citation Verification with Gemini File Search

Scan pandoc-flavored markdown drafts for citations, upload source PDFs to a Gemini File Search store, and verify each citation is grounded in its source. Produces a structured REVIEW-CITES.md report.

## Prerequisites

- `GOOGLE_API_KEY` env var set (Google AI Studio; on this machine: `export GOOGLE_API_KEY="$(cat $GEMINI_API_KEY_FILE)"`)
- Bun runtime
- `rclone` with a `google-drive:` remote configured (used to bypass Google Drive FUSE deadlocks)
- `python3` with `pymupdf4llm` installed (used for PDF text extraction in passage grounding)
- `readwise` CLI installed and authenticated (for Readwise article export in source materialization)
- One or more `.bib` files with `file` fields mapping bibkeys to PDF paths (e.g., Paperpile's `paperpile.bib`)

## Source Materialization

Before running cite-check, materialize all sources locally:

```bash
cd ${CLAUDE_SKILL_DIR}
bun materialize-sources.ts \
  --bib ~/Google\ Drive/My\ Drive/resources/Paperpile/paperpile.bib \
  --bib ./references/sources.bib \
  --refs ./references \
  --drafts ./drafts \
  --debug
```

This populates `references/` with local copies of all cited sources:
- **Paperpile PDFs** → batch `rclone copy` from Google Drive → `references/<bibkey>.pdf`
- **Readwise articles** (reports, news, speeches without PDFs) → search by title, export markdown → `references/<bibkey>.md`
- **Gaps** → printed at the end for manual action (Obsidian web clipper or manual sourcing)

After materialization, cite-check operates purely locally.

## Usage

```bash
cd ${CLAUDE_SKILL_DIR}
bun install  # first time only

# Single bib file
bun cite-check.ts --bib ~/Google\ Drive/My\ Drive/resources/Paperpile/paperpile.bib --drafts <path-to-drafts>

# Multiple bib files (Paperpile + project-local; first bib wins on duplicate keys)
bun cite-check.ts \
  --bib ~/Google\ Drive/My\ Drive/resources/Paperpile/paperpile.bib \
  --bib ./references/sources.bib \
  --drafts <path-to-drafts>
```

### CLI Flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--bib <path>` | Yes* | -- | Path to .bib file (repeatable; first wins on duplicate keys) |
| `--store <id>` | No | auto-create | Use existing File Search store ID |
| `--drafts <dir>` | No | `./drafts` | Directory with markdown draft files |
| `--out <path>` | No | `<drafts>/REVIEW-CITES.md` | Output report path |
| `--limit <n>` | No | all | Check only first N citations (smoke test) |
| `--dry-run` | No | false | Print prompts without querying |
| `--sequential` | No | false | Run queries one-at-a-time instead of Batch API (default: batch) |
| `--retry-model <model>` | No | `gemini-3.1-pro-preview` | Retry UNSUPPORTED results with a stronger model |
| `--audit` | No | false | Audit source availability without querying (checks Paperpile PDFs) |
| `--debug` | No | false | Verbose logging |

*Either `--bib` or `--store` is required.

### Ask Mode: Targeted Source Queries

Ask a specific question about a single source:

```bash
# Does Bebchuk2019 support a specific claim?
bun cite-check.ts ask @Bebchuk2019-uq "do expense ratios fall since 2010?" --bib paperpile.bib

# What does a source say about a topic?
bun cite-check.ts ask @Brav2022-ht "what are retail turnout rates?" --bib paperpile.bib --bib sources.bib
```

The `ask` mode uploads the single source PDF, queries Gemini with your question, and prints the answer with supporting passages to stdout. No report is generated.

### Cross-Directory File Resolution

When multiple `--bib` files are provided, file paths are resolved across all bib directories. This handles the common case where a project-local `sources.bib` has `file = {All Papers/...}` paths that are relative to the Paperpile folder rather than the project's `references/` directory. The tool tries each bib directory as a fallback when the primary path doesn't exist on disk.

## How It Works

1. **Extract citations** from markdown using pandoc `[@bibkey]` syntax
2. **Parse bib file** to map bibkeys to PDF file paths via `file` fields
3. **Upload PDFs** for cited bibkeys only via Gemini Files API (with manifest caching, 48h TTL). Google Drive FUSE paths are copied locally via `rclone` to avoid EDEADLK deadlocks.
4. **Query Gemini** with structured prompts for each citation, using inline file references
5. **Classify** each citation as SUPPORTED / PARTIAL / UNSUPPORTED / NOT_IN_STORE / ERROR
6. **Verify grounding** — for SUPPORTED/PARTIAL results, extract source PDF text via `pymupdf4llm` and run token-level LCS alignment to confirm the passage Gemini quoted actually exists in the source. Ungrounded passages are flagged `[UNGROUNDED]` in the report.
7. **Write report** to REVIEW-CITES.md

### Bib File Format

The `--bib` flag expects a `.bib` file where entries have a `file` field with a path relative to the bib file's directory. Paperpile's exported `paperpile.bib` follows this convention:

```bibtex
@article{Hu2024-bm,
  author = {Edwin Hu and ...},
  title = {{Custom proxy voting advice}},
  file = {All Papers/H/Hu et al. 2024 - Custom proxy voting advice.pdf},
  year = {2024}
}
```

All bib entries are parsed. Entries with a `file` field (~95% of Paperpile entries) use PDF upload. Only sources for bibkeys that are actually cited in the drafts are uploaded.

### Citation Features

- Bracketed `[@key]` and in-text `@key` citations
- Locators: `[@key, p. 42]`
- Compound cites: `[@a; @b]` (queried together)
- Footnote indirection: citations in `[^id]:` footnote bodies
- Bluebook signals: `see`, `cf.`, `see also`, etc. (softens verification)
- Parenthetical extraction: `[@key] (holding that X)`

## Output

REVIEW-CITES.md with:
- Summary counts (supported/partial/unsupported/not in store/error/ungrounded)
- Details table: status, file:line, bibkey, claim, response
- `[UNGROUNDED]` flag on any SUPPORTED/PARTIAL result whose passage failed grounding verification

## Batch Mode (Default)

By default, all citation queries are submitted as a single Gemini Batch API job. Each request uses inline file references (fileData), so there is no cross-contamination between queries.

```bash
# Default (batch)
bun cite-check.ts --bib paperpile.bib --drafts ./drafts

# Sequential (one query at a time, useful for debugging)
bun cite-check.ts --bib paperpile.bib --drafts ./drafts --sequential
```

## Audit Mode

Run `--audit` before checking citations to see which sources are available and which need to be added:

```bash
bun cite-check.ts --bib paperpile.bib --bib sources.bib --drafts ./drafts --audit
```

The audit checks each cited bibkey for PDF availability on disk (via bib `file` field with cross-directory resolution). Missing sources should be added to Paperpile.

Exit code is 1 if any sources are missing, 0 if all sources are available. No Gemini store is created and no queries are sent.

## Passage Grounding

After Gemini returns a SUPPORTED/PARTIAL result with a `supporting_passage`, the tool verifies the passage actually exists in the source PDF text using token-level LCS alignment (ported from [langextract](https://github.com/google/langextract)'s WordAligner). Two gates reject bad matches:

- **Coverage gate** (default 0.75): at least 75% of passage tokens must appear in the matched source span
- **Density gate** (default 0.33): matched tokens must be at least 33% of the source span length (rejects scattered matches)

Signal cites (`see`, `cf.`, etc.) use relaxed thresholds (0.5 coverage / 0.2 density) since they only need conceptual alignment.

Grounding requires extracting text from the source PDF. This uses `pymupdf4llm` (via `extract-pdf-text.py`) which preserves document structure, footnotes, and tables as clean markdown. Extracted text is cached in `<drafts>/.cite-check-text/`.

## Google Drive FUSE Bypass

PDF files stored on Google Drive Desktop's FUSE mount (`~/Google Drive/My Drive/`) are subject to EDEADLK deadlocks when accessed concurrently or when not locally cached. The tool detects Google Drive paths — including through symlinks (e.g., `references/All Papers → ~/Google Drive/.../Paperpile/All Papers`) — and uses `rclone copyto` to fetch them to a local cache (`~/.cache/cite-check-pdfs/`) before upload or text extraction. Requires `rclone` with a `google-drive:` remote configured.

## Architecture

```
cite-extract.ts          -- Pure citation extraction (no I/O)
gemini.ts                -- Gemini Files API wrapper (upload, query, rclone FUSE bypass)
grounding.ts             -- Post-hoc passage grounding (tokenizer, LCS aligner)
extract-pdf-text.py      -- PDF text extraction via pymupdf4llm
materialize-sources.ts   -- Copy Paperpile PDFs + Readwise articles to references/
cite-check.ts            -- CLI orchestrator (extract -> upload -> query -> ground -> report)
```
