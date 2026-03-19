# NLM Workflow Recipes

Detailed workflow patterns for common NotebookLM tasks. The SKILL.md has the command reference — this file has the recipes.

## Research Workflow

**Option A: Automated Research (recommended)**

Use the `research` command to automatically find and import sources:

```bash
# Create notebook
id=$(nlm create "AI Research" | grep -o 'notebook [^ ]*' | cut -d' ' -f2)

# Research and auto-import sources
nlm research "transformer architecture advances 2024" --notebook $id

# For comprehensive investigation
nlm research "transformer architecture advances 2024" --notebook $id --deep

# Generate synthesis
nlm generate-chat $id "What are the key findings?"
nlm audio-create $id "Summarize the key findings professionally"
```

**Option B: Manual Source Addition**

1. Create a notebook for the topic
2. Add sources manually (URLs, PDFs, text)
3. Create notes with key findings
4. Generate an audio overview for synthesis

```bash
# Create notebook
id=$(nlm create "AI Research" | grep -o 'notebook [^ ]*' | cut -d' ' -f2)

# Add sources manually
nlm add $id https://arxiv.org/paper.pdf
nlm add $id research-notes.txt

# Generate audio
nlm audio-create $id "Summarize the key findings professionally"
```

## Study Materials Workflow

Generate comprehensive study materials from sources:

```bash
# Get notebook and source IDs
nlm list
nlm sources <notebook-id>

# Generate study materials from a source
nlm study-guide <notebook-id> <source-id>  # Key concepts + review questions
nlm faq <notebook-id> <source-id>          # Common questions answered
nlm outline <notebook-id> <source-id>      # Structured overview
nlm explain <notebook-id> <source-id>      # Accessible explanations
```

## Content Analysis Workflow

Deeply analyze and transform content:

```bash
# Summarize and synthesize
nlm summarize <notebook-id> <source-id>
nlm generate-magic <notebook-id> <src1> <src2>  # Cross-source synthesis

# Critical analysis
nlm critique <notebook-id> <source-id>
nlm verify <notebook-id> <source-id>

# Creative exploration
nlm brainstorm <notebook-id> <source-id>
nlm expand <notebook-id> <source-id>

# Interactive Q&A
nlm chat <notebook-id>
```

## Executive Briefing Workflow

Create professional documents from sources:

```bash
# Generate briefing materials
nlm briefing-doc <notebook-id> <source-id>  # Executive summary + recommendations
nlm timeline <notebook-id> <source-id>      # Chronological overview
nlm toc <notebook-id> <source-id>           # Structure overview
```

## Readwise → NLM Import

Batch import Readwise highlights into a notebook by tag:

```bash
RW_NLM=$(${CLAUDE_PLUGIN_ROOT}/skills/readwise/scripts/readwise_to_nlm.py) && python3 "$RW_NLM" \
  --tag "private markets" --tag "disclosure" \
  --notebook <notebook-id>
```

For individual documents:
1. Get full text: `readwise get <id> --html --json`
2. Convert HTML to markdown and save to temp file
3. Add to NLM: `nlm add <notebook-id> /tmp/source.md`

**Important:** Always pull full text from Readwise, never from source URLs — Readwise has archived paywalled content (Bloomberg, WSJ, NYT).
