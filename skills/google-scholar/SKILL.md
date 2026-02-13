---
name: google-scholar
description: This skill should be used when the user asks to "search Google Scholar", "find academic papers", "scholar search", "lookup papers", "find citations", "academic search", "search for papers by author", "find journal articles", or needs to search Google Scholar for academic literature via the scholar CLI tool.
version: 0.1.0
---

# Google Scholar CLI (scholar)

Search Google Scholar for academic papers via the `scholar` command-line tool.

**Requires:** `scholar` on PATH (`~/.local/bin/scholar` → `~/projects/google-scholar-cli/scholar`)

**Check:** `command -v scholar || echo "MISSING: scholar CLI not installed"`

## Authentication

Before first use, authenticate by extracting cookies from an active Chrome session:

```bash
# Chrome must be running with remote debugging enabled
scholar auth --port 9222
```

Cookies are stored in `~/.google-scholar/cookies` (mode 0600).

## Core Commands

### Scholar Labs Search (AI-Enhanced)

Natural language search using Google Scholar Labs API:

```bash
# One-shot search
scholar search "what are the key papers on attention mechanisms"

# JSON output for parsing
scholar search "corporate disclosure and information asymmetry" --json

# Interactive multi-turn mode (follow-up questions)
scholar search --interactive
```

### Traditional Keyword Search

Standard Google Scholar full-text search:

```bash
# Keyword search
scholar lookup "machine learning transformers"

# Author search
scholar lookup "author:shleifer disclosure" --json

# JSON output
scholar lookup "materiality accounting" --json
```

## Quick Reference

| Need | Command |
|------|---------|
| Natural language question | `scholar search "question"` |
| Keyword/author search | `scholar lookup "keywords"` |
| JSON output | Add `--json` to any command |
| Interactive follow-ups | `scholar search --interactive` |
| Re-authenticate | `scholar auth` |

## Decision Tree: Which Command?

```
Do you have a natural language research question?
  YES → scholar search "question"
  NO  ↓
Do you need keyword-exact or author-specific results?
  YES → scholar lookup "author:name keyword"
  NO  ↓
Do you want follow-up refinement?
  YES → scholar search --interactive
```

## Output Format

**Table output (default):** Columns for #, Title, Authors, Year, Cited, Journal, followed by snippets and URLs.

**JSON output (`--json`):** Array of `ScholarResult` objects:

```json
{
  "title": "Paper Title",
  "authors": "Author A, Author B",
  "journal": "Journal Name",
  "year": "2024",
  "citations": 150,
  "snippet": "Abstract excerpt...",
  "url": "https://...",
  "pdfUrl": "https://... or null",
  "clusterId": "12345",
  "position": 1
}
```

## Domain Knowledge Integration

When searching Google Scholar, ALWAYS consult the domain knowledge file first:

**File:** `${CLAUDE_PLUGIN_ROOT}/skills/google-scholar/domain-knowledge.local.md`

This file contains the user's curated list of trusted journals, authors, and research groups. Use it to:

1. **Prioritize results** from known-good journals and authors
2. **Flag unfamiliar sources** - if a result is from an unknown journal, note it
3. **Suggest related searches** - use known authors to refine queries
4. **Assess quality** - weight results higher when they appear in trusted venues

### How to Use Domain Knowledge

```
User asks: "find papers on corporate disclosure"
    ↓
1. Read domain-knowledge.local.md
2. Run scholar search/lookup
3. Cross-reference results against trusted journals/authors
4. Present results with quality signals:
   - ★ = from trusted journal or by trusted author
   - Results from unknown sources shown without star
```

## Operational Rules

1. **Scholar is for discovery** - Use it to find new papers, not to read them
2. **Always use `--json`** when results will be processed programmatically
3. **Cross-reference domain knowledge** - Always check trusted journals/authors
4. **Auth required** - If search fails with auth errors, re-run `scholar auth`
5. **Rate limits** - Google Scholar may rate-limit; space out rapid queries
