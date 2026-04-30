---
name: cite-check
description: "Verify academic citations against source PDFs using Gemini File Search API. Use when 'check citations', 'verify cites', 'cite-check', 'run citation review', 'are my citations grounded', 'does source X support claim Y', 'what does source X say about Y', or validating that pandoc citations in markdown drafts are supported by their source documents."
user-invocable: true
---

# Citation Verification with Gemini File Search

Scan pandoc-flavored markdown drafts for citations, upload source PDFs to a Gemini File Search store, and verify each citation is grounded in its source. Produces a structured REVIEW-CITES.md report.

## Prerequisites

- `GOOGLE_API_KEY` env var set (Google AI Studio)
- Bun runtime
- One or more `.bib` files with `file` fields mapping bibkeys to PDF paths (e.g., Paperpile's `paperpile.bib`)

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
| `--batch` | No | false | Run queries concurrently (5 at a time) instead of one-at-a-time |
| `--retry-model <model>` | No | `gemini-3.1-pro-preview` | Retry UNSUPPORTED results with a stronger model |
| `--audit` | No | false | Audit source availability without querying (checks Paperpile + Readwise) |
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

The `ask` mode uploads the single source (PDF or Readwise fallback), queries Gemini with your question, and prints the answer with supporting passages to stdout. No report is generated.

### Cross-Directory File Resolution

When multiple `--bib` files are provided, file paths are resolved across all bib directories. This handles the common case where a project-local `sources.bib` has `file = {All Papers/...}` paths that are relative to the Paperpile folder rather than the project's `references/` directory. The tool tries each bib directory as a fallback when the primary path doesn't exist on disk.

## How It Works

1. **Extract citations** from markdown using pandoc `[@bibkey]` syntax
2. **Parse bib file** to map bibkeys to PDF file paths via `file` fields
3. **Upload PDFs** for cited bibkeys only to a Gemini File Search store (with bibkey metadata, dedup on re-runs)
4. **Query Gemini** with structured prompts for each citation, using File Search grounding
5. **Classify** each citation as SUPPORTED / PARTIAL / UNSUPPORTED / NOT_IN_STORE / ERROR
6. **Write report** to REVIEW-CITES.md

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

All bib entries are parsed. Entries with a `file` field (~95% of Paperpile entries) use PDF upload. Entries without a file but with a `title` can be resolved via Readwise Reader fallback. Only sources for bibkeys that are actually cited in the drafts are uploaded.

### Citation Features

- Bracketed `[@key]` and in-text `@key` citations
- Locators: `[@key, p. 42]`
- Compound cites: `[@a; @b]` (queried together)
- Footnote indirection: citations in `[^id]:` footnote bodies
- Bluebook signals: `see`, `cf.`, `see also`, etc. (softens verification)
- Parenthetical extraction: `[@key] (holding that X)`

## Output

REVIEW-CITES.md with:
- Summary counts (supported/partial/unsupported/not in store/error)
- Details table: status, file:line, bibkey, claim, response

### Readwise Reader Fallback

For sources not in Paperpile (blog posts, working papers, government documents), cite-check
automatically searches Readwise Reader by title. If found, it fetches the full text and
uploads it to the Gemini store.

**Requirements:** `readwise` CLI installed at `~/.local/bin/readwise` and authenticated.

**Workflow:** Save non-Paperpile sources to Readwise Reader -- cite-check finds them automatically.

## Batch Mode

Use `--batch` to run all citation queries concurrently (5 at a time) instead of one-at-a-time sequential mode.

```bash
bun cite-check.ts --bib paperpile.bib --drafts ./drafts --batch
```

**How it works:** Each query runs as an isolated `generateContent` call with only the relevant source file(s) attached. Queries run 5 at a time for speed while preserving file isolation.

**Why not the Batch API?** The Gemini Batch API shares file context across requests within a single job, causing cross-contamination (e.g., querying source A returns passages from source B). Concurrent isolated calls avoid this.

## Audit Mode

Run `--audit` before checking citations to see which sources are available and which need to be added:

```bash
bun cite-check.ts --bib paperpile.bib --bib sources.bib --drafts ./drafts --audit
```

The audit checks each cited bibkey for source availability:
1. Does it have a PDF on disk (via bib `file` field)?
2. If not, is it findable in Readwise Reader (by title)?
3. If neither, classifies where it should be added based on bib entry type

The audit classifies missing sources by where they should be added:
- **Add to Paperpile:** academic papers (`@article`), working papers (`@unpublished`), tech reports, conference proceedings, theses
- **Add to Readwise:** SEC filings, government documents, blog posts, news, books, misc (`@misc`, `@book`, etc.)

Exit code is 1 if any sources are missing, 0 if all sources are available. No Gemini store is created and no queries are sent.

## Architecture

```
cite-extract.ts  -- Pure citation extraction (no I/O)
gemini.ts        -- Gemini File Search API wrapper (store CRUD, upload, query, batch, Readwise fallback)
cite-check.ts    -- CLI orchestrator (extract -> upload -> query -> report)
```
