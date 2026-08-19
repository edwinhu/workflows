---
name: look-at
version: 2.0
description: "Use when the user asks to 'look at', 'analyze', 'describe', 'extract from', or 'what's in' media files like PDFs, images, diagrams, screenshots, or charts. Triggers include: 'what does this image show', 'extract the table from this PDF', 'describe this diagram', 'what's in this screenshot', 'analyze this chart', 'read this image', 'get text from this PDF', 'summarize this document', or requests for specific data extraction from visual or document files. Use for interpreted content, not literal file reading (Read tool)."
user-invocable: false
---

# Look At - Multimodal File Analysis

Multi-backend vision router for PDFs, images, diagrams, and other media files. Routes to `claude-code -p` (default), `agy -p`, `codex exec`, or GitHub Copilot (GPT-5.4) — all on subscription, none metered — and can run all four at once for independent looks at the same file.

## Tool Selection Enforcement

### Tool Routing Facts

- Read on a media file loads the full content into context regardless of how briefly you look at it — a "quick glance" costs the same thousands of tokens as a full read. Content type, not file size, determines the tool.
- Read on a PDF extracts raw text and loses table structure and visual information; look_at returns it as structured data.
- The point is context economy, not vision capability. Read pulls the whole image into *this* session's context; look_at spends a subprocess's context instead and returns text. Better vision models do not change that arithmetic — they make the cheap backends sufficient.
- Backend extraction is accurate for most use cases — start with look_at, escalate to Read only if the extraction is insufficient. Defaulting to Read "for exact text" wastes the context this skill exists to save.
- The `claude` backend spawns a child `claude-code -p`. `look_at.sh` sets `LOOK_AT_NESTED=1` so `image-read-guard.ts` stands down inside that child — without it the guard denies the child's Read and points it back at `look_at.sh`, which spawns another child. That is unbounded recursion, not a slow call.

### Red Flags

- Passing an image, PDF, or screenshot path to Read → use look_at.
- A text-based PDF with structure/tables/charts → still look_at, not Read.

### Cost & Context Benefits

| Scenario | Read Tool | look_at Tool |
|----------|-----------|--------------|
| **PDF with table** | Extracts raw text (~1000 tokens), loses table structure | Extracts table as structured data (~100 tokens) |
| **Screenshot** | Loads entire image (~500 tokens), requires interpretation | Describes content (~50 tokens) |
| **Diagram** | Shows image (~800 tokens), requires analysis | Explains architecture (~100 tokens) |
| **Multi-page PDF** | All pages loaded (~5000 tokens) | Extracts specific sections (~200 tokens) |

**look_at saves 80-95% of context tokens by extracting only relevant information.**

## When to Use

**Use look_at when you need:**
- Media files the Read tool cannot interpret
- Extracting specific information or summaries from documents
- Describing visual content in images or diagrams
- Analyzing charts, tables, or structured data in PDFs
- When analyzed/extracted data is needed, not raw file contents

**Never use look_at when:**
- Source code or plain text files needing exact contents (use Read)
- Files that need editing afterward (need literal content from Read)
- Simple file reading where no interpretation is needed
- Exact formatting or structure must be preserved

## How It Works

1. Provide a file path and a specific goal (what to extract)
2. `look_at.sh` routes to the selected backend (`claude-code -p` by default)
3. The backend analyzes the file and extracts requested information
4. Only the relevant extracted information is returned (saves context tokens)

## Usage Pattern

**CRITICAL - Display Requirement:**
Always set the Bash tool `description` parameter to show a clean invocation:
```
description: "look-at: [goal text]"
```

```bash
# Default (claude-code -p — pooled OAuth, reads images and PDFs natively)
"${CLAUDE_SKILL_DIR}/scripts/look_at.sh" \
    --file "/path/to/file.pdf" \
    --goal "Extract the title and date from this document"

# A different model family (agy, codex, copilot all work the same way)
"${CLAUDE_SKILL_DIR}/scripts/look_at.sh" \
    --file "/path/to/diagram.png" \
    --goal "Describe the architecture" \
    --backend codex

# Four independent looks at once (claude, agy, codex, copilot)
"${CLAUDE_SKILL_DIR}/scripts/look_at.sh" \
    --file "/path/to/diagram.png" \
    --goal "Score this diagram 0-10" \
    --consensus

# METERED — spends GOOGLE_API_KEY. Only for agentic mode.
"${CLAUDE_SKILL_DIR}/scripts/look_at.sh" \
    --file "/path/to/file.pdf" \
    --goal "Extract the table data" \
    --backend api --agentic
```

`${CLAUDE_SKILL_DIR}` is substituted at skill load time, so the full path is already resolved — no per-call discovery needed.

**IMPORTANT:**
- Always use absolute paths for files
- Always set Bash tool `description` to `"look-at: [goal]"` for clean UX

## Backends

| Backend | CLI | Model | Cost | Best For |
|---------|-----|-------|------|----------|
| `claude` (default) | `claude-code -p` | `claude-opus-5[1m]` unless `--model` | Pooled OAuth via CLIProxyAPI | Everything. Reads images and PDFs natively — no rasterization |
| `agy` | `agy -p` | Antigravity default | Subscription | Second opinion from a different family |
| `codex` | `codex exec` | Codex default | Subscription | Attaches the image with `-i`, so it needs no read tool at all |
| `copilot` | `copilot -p` | GPT-5.4 | Copilot subscription | Fourth opinion. PDFs rasterized first |
| `api` | `look_at.py` | Gemini API | **Metered — your `GOOGLE_API_KEY`** | Agentic mode only. Never a default, never in `--consensus` |

**`claude`, not `claude-code`, is the backend *name*; `claude-code` is the binary it runs.** Plain
`claude` would bill this session's own account — `claude-code` routes through CLIProxyAPI to the
pooled OAuth accounts, which is the cost this backend exists to avoid.

Only `claude` ingests PDFs directly. `agy` and `copilot` get page PNGs from `pdftoppm`; `codex`
gets every page attached as a separate `-i`.

The `gemini` backend is gone. It required `GEMINI_API_KEY`/`GOOGLE_API_KEY` and billed like `api` despite being documented as bundled quota, and the consumer `gemini` binary was sunset 2026-06-18.

## Consensus Mode

`--consensus` runs a comma-separated list of backends **in parallel** and outputs each result under a labeled header (`=== CLAUDE (claude-code) ===`, `=== AGY (Antigravity) ===`, …). The list is optional and defaults to all four CLI backends:

```bash
--consensus                            # claude,agy,codex,copilot
--consensus claude,codex               # narrow it to two
```

Wall-clock is the slowest backend, not the sum — they run concurrently.

A failed backend prints `[ERROR] <name> backend failed` followed by its output; the others still report, and the exit status stays 0.

**When to use:** Visual verification of diagrams where a single model may miss or underscore defects. Trust the **stricter** score — if any backend flags BLOCKING, treat it as BLOCKING.

## Response Rules

When using look_at, the response includes:
- Only the extracted information matching the goal
- Clear statement if requested information is not found
- Concise output focused on the goal (no preamble)

Use this extracted information directly in continued work without loading the full file into context.

## Supported File Types

| Type | Extensions | MIME Types |
|------|-----------|------------|
| Images | .jpg, .jpeg, .png, .webp, .heic, .heif | image/* |
| Videos | .mp4, .mpeg, .mov, .avi, .webm | video/* |
| Audio | .wav, .mp3, .aiff, .aac, .ogg, .flac | audio/* |
| Documents | .pdf, .txt, .csv, .md, .html | application/pdf, text/* |

## Model Options (`api` backend only)

These apply to `--backend api`, which is metered. The `claude` backend takes `--model` as a Claude model alias; `copilot` is pinned to GPT-5.4.

| Model | Use Case | Speed | Cost |
|-------|----------|-------|------|
| `gemini-3.1-flash-lite-preview` | Default - fast, cheap analysis | Fastest | Lowest |
| `gemini-3-flash` | More complex extraction needs | Fast | Low |
| `gemini-3-flash-preview` | Agentic vision with code execution | Fast | Low |
| `gemini-3-pro-preview` | Highest accuracy required | Medium | Medium |

**Default is `gemini-3.1-flash-lite-preview`** (the value in `look_at.py`).

## Agentic Vision Mode (`api` backend only)

For complex visual reasoning tasks, use the `--agentic` flag to enable code execution. This allows Gemini to:
- **Zoom into specific regions** of an image for detailed analysis
- **Count objects** precisely using programmatic analysis
- **Perform calculations** on visual data (measurements, statistics)
- **Process structured data** in images (charts, tables) with higher accuracy

**When to use `--agentic`:**
- Counting objects in an image ("How many items are in this photo?")
- Reading fine details ("What does the small text in the corner say?")
- Analyzing charts with specific data points ("What's the exact value for Q3?")
- Complex spatial reasoning ("Which element is closest to the center?")

**Usage:**
```bash
"${CLAUDE_SKILL_DIR}/scripts/look_at.sh" \
    --file "photo.jpg" \
    --goal "Count the number of people in this image" \
    --agentic
```

**Note:** Agentic mode automatically uses `gemini-3-flash-preview` regardless of the `--model` setting.

## Common Patterns

**REMEMBER:** Always use `description: "look-at: [goal]"` in the Bash tool call.

### Extract Specific Information
```bash
# Bash tool call with:
# description: "look-at: Extract the executive summary section"
"${CLAUDE_SKILL_DIR}/scripts/look_at.sh" \
    --file "report.pdf" \
    --goal "Extract the executive summary section"
```

### Describe Visual Content
```bash
# Bash tool call with:
# description: "look-at: List all UI elements and their layout"
"${CLAUDE_SKILL_DIR}/scripts/look_at.sh" \
    --file "screenshot.png" \
    --goal "List all UI elements and their layout"
```

### Analyze Diagrams
```bash
# Bash tool call with:
# description: "look-at: Explain the data flow and component relationships"
"${CLAUDE_SKILL_DIR}/scripts/look_at.sh" \
    --file "architecture.png" \
    --goal "Explain the data flow and component relationships"
```

### Extract Structured Data
```bash
# Bash tool call with:
# description: "look-at: Extract the table data as JSON"
"${CLAUDE_SKILL_DIR}/scripts/look_at.sh" \
    --file "table.pdf" \
    --goal "Extract the table data as JSON with columns: name, value, date"
```

### Count Objects (Agentic)
```bash
# Bash tool call with:
# description: "look-at: Count the number of people in the photo"
"${CLAUDE_SKILL_DIR}/scripts/look_at.sh" \
    --file "crowd.jpg" \
    --goal "Count the number of people visible in this image" \
    --agentic
```

### Analyze Chart Details (Agentic)
```bash
# Bash tool call with:
# description: "look-at: Extract specific data points from the chart"
"${CLAUDE_SKILL_DIR}/scripts/look_at.sh" \
    --file "quarterly_chart.png" \
    --goal "Extract the exact values for each quarter and calculate the year-over-year change" \
    --agentic
```

## Environment Setup

The four CLI backends need nothing beyond their own binaries being installed and signed in
(`claude-code`, `agy`, `codex`, `copilot`). No API key, no Python environment. `agy`, `codex` and
`copilot` additionally need `pdftoppm` (poppler-utils) to accept a PDF.

Only `--backend api` needs setup, and only because it is metered:

```bash
export GOOGLE_API_KEY="your-api-key-here"   # or GEMINI_API_KEY
```

`look_at.sh` launches it with `uv run --script`, which honours `look_at.py`'s inline PEP 723
metadata and provisions `google-genai` itself — `uv run python3` does not, and fails at the import
with a message that reads like an auth problem.

## Cost Optimization

- **`claude`, `agy`, `codex` and `copilot` are subscription backends — none bills per call.** `api`
  is the only metered path; reach for it only when you need agentic mode.
- Only extracts requested information (saves on output tokens)
- Avoids loading full files into main conversation context
- Use specific goals to minimize unnecessary processing

## Troubleshooting

| Issue | Solution |
|-------|----------|
| A CLI backend fails | Check that binary is installed and signed in: `claude-code`, `agy`, `codex`, `copilot` |
| `codex` blocks on stdin | The prompt must follow `--`; `-i/--image` is variadic and otherwise swallows it |
| Backend hangs or recurses | Confirm `look_at.sh` is the entry point — it sets `LOOK_AT_NESTED=1`; calling `claude-code -p` by hand does not, and `image-read-guard.ts` will then deny the child's Read |
| API key not set (`api` backend) | Set `GOOGLE_API_KEY` or `GEMINI_API_KEY` |
| File not found | Use absolute paths, verify file exists |
| Large file timeout | Break into smaller files or use lower-quality images |
| Rate limit errors | Add retry logic or use batch processing |
| Empty response | Check that goal is clear and specific |

## Examples

See `examples/` directory for:
- `analyze_pdf.sh` - PDF document extraction
- `describe_image.sh` - Image analysis
- `extract_table.sh` - Structured data extraction

## Related Skills

- `/gemini-batch` - For batch processing of many files
- Standard `Read` tool - For text files needing exact contents
