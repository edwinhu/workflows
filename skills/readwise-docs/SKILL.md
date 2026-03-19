---
name: readwise-docs
description: Manage Readwise Reader documents. Use when the user wants to list, save, update, or delete documents in their Reader library. Triggers on "add to reader", "save article", "list my documents", "readwise list", "reader documents".
context: fork
agent: librarian
user-invocable: false
---

# Readwise Reader Document Management

CRUD operations on the Reader document library via API v3.

## Commands

### List Documents

```bash
readwise list                                    # All documents
readwise list --limit 20                         # First 20
readwise list --tag "proxy advisors"             # By tag
readwise list --category pdf --location archive  # By category + location
readwise list --updated-after 2026-01-01T00:00:00Z
readwise list --html --json                      # With full HTML content
```

**Filter values:**

| Flag | Values |
|------|--------|
| `--location` | `new`, `later`, `shortlist`, `archive`, `feed` |
| `--category` | `article`, `email`, `rss`, `highlight`, `note`, `pdf`, `epub`, `tweet`, `video` |
| `--tag` | Any tag name (server-side filter, up to 5 for AND logic) |

### Get Document

```bash
readwise get <id>                  # Summary view
readwise get <id> --json           # Full JSON
readwise get <id> --html --json    # With HTML content
```

### Save URL

```bash
readwise save https://example.com/article
readwise save https://example.com/article --tag research
```

### Update Metadata

```bash
readwise update <id> --location archive
readwise update <id> --category article
```

### Delete Document

```bash
readwise delete <id>
```

### Tags

```bash
readwise tags           # List all tags
readwise tags --json    # As JSON
```

## Highlights & Books (v2 API)

```bash
readwise highlights                              # All highlights
readwise highlights --search "fiduciary"         # Keyword search
readwise highlights --book-id 12345 --json       # By source

readwise books                                   # All sources
readwise books --category articles --search "law"
```

## Piping & Scripting

All commands support `--json` for machine-readable output:

```bash
# Get IDs of all PDFs
readwise list --category pdf --json | jq -r '.[].id'

# Count highlights per book
readwise books --json | jq '.[] | {title, num_highlights}'

# Export all tags
readwise tags --json > tags.json
```
