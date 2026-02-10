---
name: readwise-search
description: Search Readwise highlights. Use when the user wants to find highlights, quotes, notes, or annotations from their reading library. Triggers on "search highlights", "find in readwise", "what did I highlight about", "my notes on".
---

# Readwise Highlight Search

## Decision Tree

```
1. Do you know the EXACT document or author?
   YES -> Use fulltext filters (--author, --title, --text)
   NO  -> Use vector search (semantic query)
2. Need document-level results (not highlights)?
   YES -> Use `readwise list` with --tag or --category filters
   NO  -> Use `readwise search`
```

## Quick Reference

### Vector + Fulltext Search (Highlights)

```bash
# Semantic search
readwise search "fiduciary duty broker-dealer"

# With filters
readwise search "regulation" --author "Jackson" --title "Financial"
readwise search "proxy" --highlight-tag "corps"

# JSON output for piping
readwise search "query" --json
```

**Fulltext filter fields:**

| Flag | Searches |
|------|----------|
| `--author` | Document author name |
| `--title` | Document title |
| `--note` | Highlight notes/annotations |
| `--text` | Highlight text content |
| `--highlight-tag` | Tags on highlights |

### Document Search (Reader API)

```bash
# By tag
readwise list --tag "proxy advisors" --json

# By category
readwise list --category pdf --location archive

# Recent updates
readwise list --updated-after 2026-01-01T00:00:00Z --limit 20
```

### Highlight Keyword Search (v2 API)

```bash
# Simple text search across highlights
readwise highlights --search "fiduciary" --limit 20 --json
```

## When to Use Each

| Need | Command | Speed |
|------|---------|-------|
| Semantic/conceptual search | `readwise search "query"` | ~2s |
| Keyword in highlight text | `readwise highlights --search "term"` | ~1s per page |
| Documents by tag | `readwise list --tag "X"` | ~1s per page |
| Specific document | `readwise get <id>` | ~0.5s |

## Output Format

Use `--json` for structured output. Without it, results are printed as aligned tables.

JSON search results include a `score` field (higher = more relevant, >0.01 typically meaningful).
