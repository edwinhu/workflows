---
name: readwise
description: This skill should be used when the user asks to "search Readwise", "find highlights", "get quotes from my reading", "add highlights to notebook", "search my annotations", "get full document text", "fetch article content", "add tagged documents to notebook", or needs to query their Readwise library.
version: 0.8.0
---

# Readwise

Access Readwise highlights (via MCP) and full document content (via Reader API).

<EXTREMELY-IMPORTANT>
## IRON LAW: Main Chat NEVER Calls Readwise Tools

**EVERY READWISE OPERATION MUST GO THROUGH LIBRARIAN. This is not negotiable.**

Main chat MUST NOT:
- Call `mcp__readwise__search_readwise_highlights` directly
- Call any `mcp__readwise__*` tool
- “Just quickly check” highlights
- “Look up one thing” in Readwise

**If you’re about to call a Readwise tool in main chat, STOP. Spawn a librarian sub-agent instead.**
</EXTREMELY-IMPORTANT>

### Permission Model

| Context | Readwise MCP Tools | Reader API Script |
|---------|-------------------|-------------------|
| Main chat | **FORBIDDEN** | **FORBIDDEN** |
| Librarian sub-agent | ALLOWED | ALLOWED |

### Red Flag Detection

```
STOP if you catch yourself thinking:
- “Let me quickly search Readwise...”
- “I’ll just check the highlights...”
- “The MCP tool is right here in my tool list...”

These thoughts in MAIN CHAT = VIOLATION. Delegate instead.
```

### Rationalization Prevention

| Thought | Reality |
|---------|---------|
| “Just one quick search” | Quick = context pollution. Delegate. |
| “MCP tool is available” | Available != permitted in main chat. Delegate. |
| “I’ll summarize results” | You still receive full payload. Delegate. |
| “User wants speed” | Sub-agents ARE fast. Delegate. |
| “I know the exact tag” | Use Python script via librarian. Delegate. |
| “It’s a simple query” | Simple still pollutes. Delegate. |

### Correct Pattern

```
User: “Search my Readwise for proxy advisor articles”

MAIN CHAT RESPONSE:
Task(subagent_type=”workflows:librarian”, prompt=”Search Readwise for proxy advisor articles and summarize findings”)

NEVER IN MAIN CHAT:
mcp__readwise__search_readwise_highlights(...)
```

### Honesty Requirement

<EXTREMELY-IMPORTANT>
**Calling Readwise tools directly in main chat is not “being helpful” - it’s violating the workflow.**

When you call Readwise directly, you are:
- Wasting the user’s context window with verbose results
- Using the wrong tool (MCP = semantic only, no full docs)
- Skipping the proper workflow (librarian knows search -> format -> NotebookLM)

**"I'll just check quickly" is the rationalization. The librarian exists for this purpose. Use it.**
</EXTREMELY-IMPORTANT>

---

## Tag-Based Workflow (CRITICAL)

<EXTREMELY-IMPORTANT>
**When user mentions items were added by tag, NEVER use MCP semantic search.**

### Trigger Phrases
- "we added items tagged X"
- "I thought we added X to NLM"
- "are they not in notebooklm?"
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
    │ 2. USE READER API   │ ← For tagged items
    │    --tag "X"        │
    │    NOT MCP search!  │
    └─────────────────────┘
```

### Red Flags for Tag-Based Queries

```
STOP if user mentions tagged items AND you're about to:
- Call mcp__readwise__search_readwise_highlights
- Do "semantic search" for tagged content
- Skip checking NLM first

These are WORKFLOW VIOLATIONS. The content is already curated by tag.
```

### Correct Response Pattern

```
User: "I thought we added the Egan-Jones letters to NLM? They were tagged proxy advisors."

CORRECT:
1. Task(librarian) → Check NLM for proxy advisors notebook
2. If not found: Use Reader API with --tag "proxy advisors"
3. NEVER: mcp__readwise__search_readwise_highlights("Egan-Jones...")

WRONG:
- Immediately calling MCP search
- Skipping NLM check
- Using semantic search for tagged content
```

### Rationalization Prevention for Tags

| Thought | Reality |
|---------|---------|
| "MCP will find it faster" | Tags are exact. Reader API is correct tool. |
| "Semantic search is more flexible" | User already organized by tag. Respect that. |
| "I'll check NLM after" | NLM FIRST. This is the knowledge hierarchy. |
| "Let me verify it's there" | Check NLM, don't re-search everything. |
</EXTREMELY-IMPORTANT>

---

## Decision Tree: Which Method to Use?

```
┌─────────────────────────────────────────────────────────────┐
│ 1. CHECK NLM FIRST (always)                                  │
│    Is the content already in a NotebookLM notebook?          │
│    → nlm list && nlm chat <id> "query"                       │
└─────────────────────────────────────────────────────────────┘
                          │
                    Not in NLM?
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Do you know the exact tag(s)?                             │
│                                                              │
│ YES → Reader API (tag-based fetch)                           │
│       Fast, gets full documents, no semantic search needed   │
│       → python3 skills/readwise/scripts/readwise_to_nlm.py \ │
│           --tag "tag" --notebook <id>                        │
│                                                              │
│ NO → MCP (semantic search) - LAST RESORT                     │
│      Find highlights by meaning/keywords                     │
│      → mcp__readwise__search_readwise_highlights             │
└─────────────────────────────────────────────────────────────┘
```

## Quick Reference

| Need | Method | Command |
|------|--------|---------|
| Full docs by tag | Reader API | `python3 skills/readwise/scripts/readwise_to_nlm.py --tag “proxy advisors” --notebook <id>` |
| Semantic search | MCP | `mcp__readwise__search_readwise_highlights` |
| List tags/dry-run | Reader API | `python3 skills/readwise/scripts/readwise_to_nlm.py --tag “proxy advisors” --notebook <id> --dry-run` |

## Two Data Sources

| Source | Tool | Use Case |
|--------|------|----------|
| **Full Documents** | Reader API (Python) | Known tags, need complete article text |
| **Highlights** | `mcp__readwise__search_readwise_highlights` | Semantic search for quotes, annotations |

## MCP Tool

```
mcp__readwise__search_readwise_highlights
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `vector_search_term` | string | Semantic search query (required) |
| `full_text_queries` | array | Full-text filters on specific fields |

### Full-Text Query Fields

- `document_author` - Author name
- `document_title` - Document/book title
- `highlight_note` - User’s annotations
- `highlight_plaintext` - The highlight text itself
- `highlight_tags` - Tags applied to highlights

### Example Search

```json
{
  “vector_search_term”: “proxy advisors ISS Glass Lewis shareholder voting”,
  “full_text_queries”: [
    {“field_name”: “highlight_plaintext”, “search_term”: “proxy”}
  ]
}
```

## Response Structure

Each result includes:

```json
{
  “id”: 123456789,
  “score”: 0.025,
  “attributes”: {
    “document_author”: “Author Name”,
    “document_category”: “books|articles”,
    “document_tags”: [“tag1”, “tag2”],
    “document_title”: “Document Title”,
    “highlight_note”: “User’s annotation”,
    “highlight_plaintext”: “The highlighted text...”,
    “highlight_tags”: [“htag1”]
  }
}
```

## Formatting for NotebookLM

When adding highlights to NotebookLM, format as markdown grouped by source:

```markdown
# Readwise Highlights: [Topic]

Generated: [date]
Search: vector=”[query]” + full_text=”[filter]”

---

## From “[Document Title]” by [Author]
**Tags:** tag1, tag2

> “[Highlight text...]”

**Note:** [User’s annotation if present]

---

[Repeat for each source document]
```

### Formatting Guidelines

1. **Group by document** - All highlights from same source together
2. **Include metadata** - Author, tags, category when available
3. **Show user notes** - Include `highlight_note` if present
4. **Quote highlights** - Use blockquotes for the actual text
5. **Add provenance** - Include search terms used at top

## Adding to NotebookLM

Pipe formatted markdown to nlm CLI:

```bash
cat <<'EOF' | /Users/vwh7mb/projects/nlm/nlm add <notebook-id> -
[formatted markdown]
EOF
```

NotebookLM will auto-generate a title from content. Optionally rename:

```bash
/Users/vwh7mb/projects/nlm/nlm rename-source <source-id> “Readwise: [Topic] Highlights”
```

## Workflow Pattern

1. **Search** - Use semantic + full-text for best results
2. **Filter** - Consider score threshold (>0.01 is usually relevant)
3. **Format** - Group by document, include metadata
4. **Add** - Pipe to nlm via stdin
5. **Verify** - Check sources list in notebook

## Tips

- Combine vector search (semantic) with full-text (keyword) for precision
- Results are ranked by relevance score
- Large result sets (50+) can be split into themed sources
- Include search terms in output for provenance tracking
- User notes (`highlight_note`) often contain valuable context

## Anti-Pattern: Never Fetch from Source URL

**WRONG:**
1. Search Readwise, find document
2. Try to fetch from original URL (fails - paywalled)

**RIGHT:**
1. Search Readwise, find document
2. Get full text FROM READWISE using Reader API with `withHtmlContent=true`

If a document is in Readwise, the full text is already there. Never go back to the source URL.

---

# Reader API (Full Documents)

For fetching complete document content (not just highlights), use the Reader API.

## Python Client

Located at: `/Users/vwh7mb/projects/readwise-reader-tools/src/reader.py`

```python
from reader import ReaderClient

# Token from agenix
import os
token = open(“/var/folders/01/wzs3mqmn3jx2b81f0dcq9w8h0000gq/T/agenix/readwise-token”).read().strip()
client = ReaderClient(token)
```

## Key Methods

### List Documents

```python
# All documents
docs = client.list_documents()

# Filter by location: new, later, shortlist, archive, feed
docs = client.list_documents(location=”archive”)

# Filter by category: article, email, rss, highlight, note, pdf, epub, tweet, video
docs = client.list_documents(category=”article”)
```

### Get Full Document Content

```python
# Get document with full HTML content
doc = client.get_document(document_id, with_html_content=True)

# Access the content
html = doc.get(“html_content”)  # Full HTML
title = doc.get(“title”)
author = doc.get(“author”)
source_url = doc.get(“source_url”)
```

### Find Document by URL

```python
doc = client.find_by_url(“https://example.com/article”)
```

### Save New Document

```python
result = client.add_article(
    url=”https://example.com/article”,
    html=”<html>...</html>”,  # Optional: for paywall bypass
    title=”Article Title”,
    author=”Author Name”,
    tags=[“research”, “topic”]
)
```

## API Endpoints Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v3/list/` | GET | List/search documents |
| `/api/v3/save/` | POST | Save new document |
| `/api/v3/update/<id>/` | PATCH | Update document |
| `/api/v3/delete/<id>/` | DELETE | Remove document |

### List Parameters

| Parameter | Description |
|-----------|-------------|
| `id` | Filter by document ID |
| `location` | new, later, shortlist, archive, feed |
| `category` | article, email, rss, pdf, epub, tweet, video |
| `updatedAfter` | ISO datetime filter |
| `withHtmlContent` | Include full HTML (slower) |
| `pageCursor` | Pagination cursor |

## Workflow: Add Full Article to NotebookLM

1. **Find the document**
   ```python
   doc = client.find_by_url(“https://example.com/article”)
   # or
   doc = client.get_document(doc_id, with_html_content=True)
   ```

2. **Extract and clean content**
   ```python
   from html2text import html2text
   markdown = html2text(doc[“html_content”])
   ```

3. **Add to NotebookLM**
   ```bash
   echo “$markdown” | /Users/vwh7mb/projects/nlm/nlm add <notebook-id> -
   ```

## Rate Limits

- Standard endpoints: 20 requests/minute
- Save/Update: 50 requests/minute

## Authentication

Token stored via agenix at:
`/var/folders/01/wzs3mqmn3jx2b81f0dcq9w8h0000gq/T/agenix/readwise-token`

Same token works for both Reader API and Highlights MCP.

## API Reference

See `skills/readwise/references/reader-api.md` for full Reader API documentation.

---

# Batch Add by Tag (Recommended)

For adding multiple documents by tag to NotebookLM, use the reusable script.

## Script Location

`skills/readwise/scripts/readwise_to_nlm.py`

## Usage

```bash
# Dry run - see what would be added
python3 skills/readwise/scripts/readwise_to_nlm.py \
  --tag “proxy advisors” \
  --notebook 1457a61e-02ff-4ef0-a0de-deeb0e931972 \
  --dry-run

# Add all documents with tag to notebook
python3 skills/readwise/scripts/readwise_to_nlm.py \
  --tag “proxy advisors” \
  --notebook 1457a61e-02ff-4ef0-a0de-deeb0e931972

# Verbose output
python3 skills/readwise/scripts/readwise_to_nlm.py \
  --tag “Corps” \
  --notebook abc123 \
  --verbose
```

## Requirements

```bash
pip install requests html2text
```

## How It Works

1. Fetches all documents from Readwise with `withHtmlContent=true`
2. Filters by tag (case-insensitive match on `tags` field)
3. Converts HTML to Markdown using `html2text`
4. Pipes each document to `nlm add <notebook-id> -`

## Via Opencode (Librarian Pattern)

For ad-hoc requests, delegate to opencode:

```bash
# Simple task (list, single add)
opencode run -m github-copilot/gpt-5-mini \
  “Add documents tagged ‘Corps’ to notebook abc123”

# Long context (many docs, research)
opencode run -m google/antigravity-gemini-3-flash \
  “Search readwise for highlights on activism and add to notebook xyz”
```

Note: Opencode tasks need ~15 min timeout for multi-document workflows.

---

# Learnings & Tips

## Tag Filtering

- Tags are stored in `tags` field as list of strings
- Filter with: `tag.lower() in [t.lower() for t in doc.get(“tags”, [])]`
- Common tags: document categories, topics, project names

## HTML Content

- Use `withHtmlContent=true` parameter to get full text
- Fetching HTML is slower - only request when needed
- Some documents may lack HTML (PDFs, certain imports)

## Dependencies

- `html2text` - converts HTML to clean Markdown
- `requests` - HTTP client for API calls
- Both available via pip

## Practical Notes

- Rate limit: 20 req/min for list, 50 req/min for save/update
- Pagination: use `nextPageCursor` from response
- Large batches: script handles pagination automatically
- Timeouts: allow 60s per request, 15min for full workflows
