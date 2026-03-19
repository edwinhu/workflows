---
name: readwise
description: This skill should be used when the user asks to "search Readwise", "find highlights", "get quotes from my reading", "add highlights to notebook", "search my annotations", "get full document text", "fetch article content", "add tagged documents to notebook", or needs to query their Readwise library.
version: 0.9.0
context: fork
agent: librarian
user-invocable: false
---

# Readwise

<EXTREMELY-IMPORTANT>
## IRON LAW: Main Chat NEVER Calls Readwise Tools or CLI

**EVERY READWISE OPERATION MUST GO THROUGH LIBRARIAN. This is not negotiable.**

Main chat MUST NOT:
- Call `mcp__readwise__search_readwise_highlights` directly
- Call any `mcp__readwise__*` tool
- Run `readwise` CLI commands directly
- "Just quickly check" highlights

**If you're about to do anything Readwise in main chat, STOP. Spawn a librarian sub-agent instead.**
</EXTREMELY-IMPORTANT>

### Permission Model

| Context | Readwise CLI | Readwise MCP Tools |
|---------|-------------|-------------------|
| Main chat | **FORBIDDEN** | **FORBIDDEN** |
| Librarian sub-agent | ALLOWED | NOT NEEDED (CLI replaces MCP) |

### Red Flag Detection

```
STOP if you catch yourself thinking:
- "Let me quickly search Readwise..."
- "I'll just run readwise search..."
- "The MCP tool is right here in my tool list..."

These thoughts in MAIN CHAT = VIOLATION. Delegate instead.
```

### Correct Pattern

```
User: "Search my Readwise for proxy advisor articles"

MAIN CHAT RESPONSE:
Task(subagent_type="workflows:librarian", prompt="Search Readwise for proxy advisor articles and summarize findings")

NEVER IN MAIN CHAT:
readwise search "proxy advisors"
mcp__readwise__search_readwise_highlights(...)
```

---

## Tag-Based Workflow

<EXTREMELY-IMPORTANT>
**When user mentions items were added by tag, NEVER use semantic search.**

### Trigger Phrases
- "we added items tagged X"
- "I thought we added X to NLM"
- "items tagged [tag]"
- "documents with tag [tag]"

### Required Workflow

```
User mentions tagged items or NLM content
              │
              ▼
    ┌─────────────────────┐
    │ 1. CHECK NLM FIRST  │ ← MANDATORY
    │    nlm list         │
    │    nlm chat <id>    │
    └─────────────────────┘
              │
       Not in NLM?
              ▼
    ┌─────────────────────┐
    │ 2. USE readwise list│ ← For tagged items
    │    --tag "X"        │
    │    NOT search!      │
    └─────────────────────┘
```
</EXTREMELY-IMPORTANT>

---

## Readwise CLI Quick Reference

The `readwise` CLI (`~/.local/bin/readwise`) covers all Readwise API surfaces.

| Need | Command |
|------|---------|
| Semantic search highlights | `readwise search "query"` |
| Documents by tag | `readwise list --tag "X"` |
| Full document content | `readwise get <id> --html` |
| RAG chat over highlights | `readwise chat "question"` |
| Keyword search highlights | `readwise highlights --search "term"` |
| List all tags | `readwise tags` |
| Prune stale docs | `readwise prune` |

**Sub-skills with detailed reference:**

| Skill | Purpose |
|-------|---------|
| `readwise-search` | Vector + fulltext highlight search |
| `readwise-docs` | Document CRUD (list, get, save, update, delete) |
| `readwise-chat` | GPT-5.1 RAG chat over highlights (fallback — prefer `readwise search` + Claude synthesis) |
| `readwise-prune` | Two-pass stale document cleanup |

---

## Batch Add to NLM (by tag)

```bash
python3 /Users/vwh7mb/projects/workflows/skills/readwise/scripts/readwise_to_nlm.py \
  --tag "proxy advisors" --tag "disclosure" \
  --notebook <notebook-id>
```

Add `--dry-run` to preview. Add `--verbose` for detailed output.

## Anti-Pattern: Never Fetch from Source URL

**WRONG:** Search Readwise, find document, fetch from original URL (fails for paywalled content).

**RIGHT:** Search Readwise, get full text FROM READWISE using `readwise get <id> --html`.

If a document is in Readwise, the full text is already there. Never go back to the source URL.
