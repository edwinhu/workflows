# Look At - Multimodal File Analysis Skill

Analyze media files (PDFs, images, diagrams) using Gemini 2.5 Flash Lite for fast, cost-effective interpretation.

## Overview

The `look-at` skill provides a tool for analyzing files that require interpretation beyond raw text. It uses Google's Gemini API to extract specific information from documents, images, diagrams, and other media files while saving context tokens by only returning the extracted information.

**Inspired by:** oh-my-opencode's `look_at` tool

## Quick Start

### 1. Install Dependencies

```bash
pip install google-genai
```

Or add to your `pixi.toml`:
```toml
[dependencies]
google-genai = ">=1.0.0"
```

### 2. Set API Key

Get your API key from https://aistudio.google.com/app/apikey

```bash
export GOOGLE_API_KEY="your-api-key-here"
```

Add to your shell profile for persistence:
```bash
echo 'export GOOGLE_API_KEY="your-api-key-here"' >> ~/.bashrc
```

### 3. Use the Skill

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py \
    --file "/path/to/file.pdf" \
    --goal "Extract the title and date"
```

## When to Use

✅ **Use look-at for:**
- PDFs with complex layouts or visual elements
- Images containing text, diagrams, or UI elements
- Charts, graphs, and data visualizations
- Architecture diagrams and flowcharts
- Screenshots of applications or documents
- Any file where you need specific extracted information, not full contents

❌ **Don't use look-at for:**
- Source code files (use Read tool)
- Plain text files (use Read tool)
- Files that need editing (use Read then Edit)
- When you need exact file structure (YAML, JSON, config files)

## Directory Structure

```
look-at/
├── SKILL.md              # Skill definition for Claude Code
├── README.md             # This file
├── requirements.txt      # Python dependencies
├── scripts/
│   └── look_at.py       # Main analysis script
├── examples/
│   ├── analyze_pdf.sh   # PDF extraction examples
│   ├── describe_image.sh # Image analysis examples
│   └── extract_table.sh  # Table extraction examples
└── references/
    ├── api-details.md   # Gemini API technical details
    └── use-cases.md     # Common patterns and use cases
```

## Usage Examples

### Extract from PDF
```bash
python3 scripts/look_at.py \
    --file "/home/user/report.pdf" \
    --goal "Extract the executive summary section"
```

### Describe Image
```bash
python3 scripts/look_at.py \
    --file "/home/user/diagram.png" \
    --goal "Describe the system architecture and data flow"
```

### Extract Table Data
```bash
python3 scripts/look_at.py \
    --file "/home/user/data.pdf" \
    --goal "Extract the table as JSON: {name, value, date}"
```

### With Custom Model
```bash
python3 scripts/look_at.py \
    --file "/home/user/complex_doc.pdf" \
    --goal "Extract methodology section" \
    --model "gemini-2.5-flash"
```

## Model Options

| Model | Best For | Speed | Cost |
|-------|----------|-------|------|
| gemini-2.5-flash-lite | Most tasks (default) | Fastest | Lowest |
| gemini-2.5-flash | Complex extraction | Fast | Low |
| gemini-1.5-pro | Highest accuracy | Medium | Medium |

## Features

- **Context Token Savings:** Only extracts requested information, not full file contents
- **Cost Effective:** Uses Gemini 2.5 Flash Lite by default (~50% cheaper than standard)
- **Fast:** Typical response in 2-5 seconds for small files
- **Flexible:** Supports images, videos, audio, PDFs, and text documents
- **Automatic Cleanup:** Uploaded files are deleted after analysis

## Troubleshooting

### API Key Not Set
```bash
Error: GOOGLE_API_KEY environment variable not set
```
**Solution:** Export your API key as shown in setup

### Package Not Installed
```bash
ModuleNotFoundError: No module named 'google'
```
**Solution:** Install with `pip install google-genai`

### File Not Found
```bash
Error: File not found: /path/to/file.pdf
```
**Solution:** Use absolute paths and verify file exists

### Rate Limit Errors
```bash
Error: Rate limit exceeded
```
**Solution:** Wait a few seconds and retry, or implement exponential backoff

## Cost Optimization

1. **Use Flash Lite:** Default model is optimal for most tasks
2. **Be Specific:** Clear goals = fewer tokens = lower cost
3. **Extract Once:** Cache results to avoid re-processing
4. **Right Tool:** Use Read tool for plain text to avoid API costs

## Comparison with oh-my-opencode

This skill is inspired by oh-my-opencode's `look_at` tool:

| Feature | oh-my-opencode | This Skill |
|---------|----------------|------------|
| Architecture | Child session + agent | Direct API call |
| Model | Configurable Gemini | Gemini 2.5 Flash Lite |
| File Handling | File passthrough | Upload to API |
| Tool Restrictions | Disables task/read/etc | N/A (direct call) |
| Context Isolation | Full session isolation | Single API call |

Both achieve the same goal: offload file analysis to a fast, cheap model to extract specific information without loading full files into the main conversation context.

## Related Skills

- `/gemini-batch` - For batch processing many files
- Standard Read tool - For text files needing exact contents
- `/jupytext` - For working with Jupyter notebooks
- `/marimo` - For marimo reactive notebooks

## Further Reading

- [SKILL.md](SKILL.md) - Full skill documentation
- [references/api-details.md](references/api-details.md) - Gemini API technical details
- [references/use-cases.md](references/use-cases.md) - Common patterns and examples
- [Gemini API Documentation](https://ai.google.dev/docs)

## License

Part of the workflows plugin for Claude Code.
