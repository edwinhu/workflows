---
name: look-at
version: 1.0
description: "This skill should be used when the user asks to 'look at', 'analyze', 'describe', 'extract from', or 'what's in' media files like PDFs, images, diagrams, screenshots, or charts. Triggers include: 'what does this image show', 'extract the table from this PDF', 'describe this diagram', 'what's in this screenshot', 'analyze this chart', 'read this image', 'get text from this PDF', 'summarize this document', or requests for specific data extraction from visual or document files. Use when analyzed/interpreted content is needed rather than literal file reading (which uses Read tool)."
---

# Look At - Multimodal File Analysis

Fast, cost-effective file analysis using Google's Gemini 2.5 Flash Lite model for PDFs, images, diagrams, and other media files.

## When to Use

**Use look_at when you need:**
- Media files the Read tool cannot interpret
- Extracting specific information or summaries from documents
- Describing visual content in images or diagrams
- Analyzing charts, tables, or structured data in PDFs
- When analyzed/extracted data is needed, not raw file contents

**Do NOT use look_at when:**
- Source code or plain text files needing exact contents (use Read)
- Files that need editing afterward (need literal content from Read)
- Simple file reading where no interpretation is needed
- You need to preserve exact formatting or structure

## How It Works

1. You provide a file path and a specific goal (what to extract)
2. The helper script uploads the file to Gemini's API
3. Gemini 2.5 Flash Lite analyzes the file and extracts requested information
4. Only the relevant extracted information is returned (saves context tokens)

## Usage Pattern

```bash
# Basic usage
python3 ${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py \
    --file "/path/to/file.pdf" \
    --goal "Extract the title and date from this document"

# With custom model
python3 ${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py \
    --file "/path/to/diagram.png" \
    --goal "Describe the architecture shown in this diagram" \
    --model "gemini-2.5-flash"
```

**IMPORTANT:** Always use absolute paths for files.

## Response Rules

When using look_at, you will receive:
- Only the extracted information matching the goal
- Clear statement if requested information is not found
- Concise output focused on the goal (no preamble)

This extracted information can be used directly in your continued work without loading the full file into context.

## Supported File Types

| Type | Extensions | MIME Types |
|------|-----------|------------|
| Images | .jpg, .jpeg, .png, .webp, .heic, .heif | image/* |
| Videos | .mp4, .mpeg, .mov, .avi, .webm | video/* |
| Audio | .wav, .mp3, .aiff, .aac, .ogg, .flac | audio/* |
| Documents | .pdf, .txt, .csv, .md, .html | application/pdf, text/* |

## Model Options

| Model | Use Case | Speed | Cost |
|-------|----------|-------|------|
| `gemini-2.5-flash-lite` | Default - fast, cheap analysis | Fastest | Lowest |
| `gemini-3-flash` | More complex extraction needs | Fast | Low |
| `gemini-3-pro-preview` | Highest accuracy required | Medium | Medium |

**Default is gemini-2.5-flash-lite** for optimal speed/cost ratio.

## Common Patterns

### Extract Specific Information
```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py \
    --file "report.pdf" \
    --goal "Extract the executive summary section"
```

### Describe Visual Content
```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py \
    --file "screenshot.png" \
    --goal "List all UI elements and their layout"
```

### Analyze Diagrams
```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py \
    --file "architecture.png" \
    --goal "Explain the data flow and component relationships"
```

### Extract Structured Data
```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py \
    --file "table.pdf" \
    --goal "Extract the table data as JSON with columns: name, value, date"
```

## Environment Setup

**Required environment variable:**
```bash
export GOOGLE_API_KEY="your-api-key-here"
```

**Required Python package:**
```bash
pip install google-genai
```

For pixi-managed projects, add to `pixi.toml`:
```toml
[dependencies]
google-genai = ">=1.0.0"
```

## Cost Optimization

- **Gemini 2.5 Flash Lite** is the most cost-effective option
- Only extracts requested information (saves on output tokens)
- Avoids loading full files into main conversation context
- Use specific goals to minimize unnecessary processing

## Troubleshooting

| Issue | Solution |
|-------|----------|
| API key not set | Set `GOOGLE_API_KEY` environment variable |
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
