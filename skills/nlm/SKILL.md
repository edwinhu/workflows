---
name: nlm
description: This skill should be used when the user asks to "create a notebook", "add source to notebook", "generate audio overview", "create podcast", "manage NotebookLM", "nlm", "add PDF to notebook", "list notebooks", "summarize sources", "generate study guide", "create FAQ", "briefing document", "chat with notebook", "generate outline", "research a topic", "deep research", or needs to interact with Google NotebookLM via the nlm CLI tool.
version: 0.2.0
---

# NotebookLM CLI (nlm)

Manage Google NotebookLM notebooks, sources, notes, and audio overviews via the `nlm` command-line tool.

**Requires:** `nlm` on PATH (`~/.local/bin/nlm` → `~/projects/nlm/nlm`)

**Check:** `command -v nlm || echo "MISSING: nlm CLI not installed"`

## Authentication

Before first use, authenticate with Google:

```bash
nlm auth
```

This launches a browser for OAuth. Credentials are stored in `~/.nlm/env`.

To check available browser profiles:
```bash
nlm auth --all --notebooks
```

## Core Commands

### Notebook Management

```bash
# List all notebooks
nlm list

# Create a new notebook
nlm create “Research Notes”

# Delete a notebook
nlm rm <notebook-id>

# Get notebook analytics
nlm analytics <notebook-id>
```

### Source Management

Add sources from URLs, files, or stdin:

```bash
# Add URL source
nlm add <notebook-id> https://example.com/article

# Add PDF file
nlm add <notebook-id> document.pdf

# Add from stdin
echo “Some text content” | nlm add <notebook-id> -

# Add with specific MIME type
cat data.json | nlm add <notebook-id> - -mime=”application/json”

# Add YouTube video
nlm add <notebook-id> https://www.youtube.com/watch?v=VIDEO_ID

# List sources in notebook
nlm sources <notebook-id>

# Rename a source
nlm rename-source <source-id> “New Title”

# Remove a source
nlm rm-source <notebook-id> <source-id>

# Refresh source content
nlm refresh-source <source-id>
```

### Note Management

```bash
# List notes in notebook
nlm notes <notebook-id>

# Create new note
nlm new-note <notebook-id> “Note Title”

# Update note content
nlm update-note <notebook-id> <note-id> “New content” “New Title”

# Remove note
nlm rm-note <note-id>
```

### Audio Overviews

Generate AI podcast-style audio summaries:

```bash
# Create audio overview with instructions
nlm audio-create <notebook-id> “Focus on key themes and provide a professional summary”

# List audio overviews
nlm audio-list <notebook-id>

# Get audio overview status/content
nlm audio-get <notebook-id>

# Download audio file (requires --direct-rpc)
nlm audio-download <notebook-id> output.mp3 --direct-rpc

# Share audio (private)
nlm audio-share <notebook-id>

# Share audio (public)
nlm audio-share <notebook-id> --public

# Delete audio
nlm audio-rm <notebook-id>
```

### Video Overviews

```bash
# Create video overview
nlm video-create <notebook-id> “Instructions for video”

# List video overviews
nlm video-list <notebook-id>

# Download video (requires --direct-rpc)
nlm video-download <notebook-id> output.mp4 --direct-rpc
```

### Generation Commands

```bash
# Generate notebook guide (short summary)
nlm generate-guide <notebook-id>

# Generate comprehensive content outline
nlm generate-outline <notebook-id>

# Generate new content section
nlm generate-section <notebook-id>

# Free-form chat generation
nlm generate-chat <notebook-id> "What are the main themes?"

# Interactive chat session
nlm chat <notebook-id>

# Generate magic view synthesis from specific sources
nlm generate-magic <notebook-id> <source-id-1> <source-id-2>
```

### Content Transformation Commands

Transform your sources into different formats. All commands take `<notebook-id> <source-id> [source-id...]`:

```bash
# Summarize content from sources
nlm summarize <notebook-id> <source-id>

# Generate study guide with key concepts and review questions
nlm study-guide <notebook-id> <source-id>

# Generate FAQ from sources
nlm faq <notebook-id> <source-id>

# Create professional briefing document
nlm briefing-doc <notebook-id> <source-id>

# Rephrase content in different words
nlm rephrase <notebook-id> <source-id>

# Expand on content with more detail
nlm expand <notebook-id> <source-id>

# Get a critique of the content
nlm critique <notebook-id> <source-id>

# Brainstorm ideas from sources
nlm brainstorm <notebook-id> <source-id>

# Verify facts in sources
nlm verify <notebook-id> <source-id>

# Explain concepts in accessible language
nlm explain <notebook-id> <source-id>

# Create a structured outline from sources
nlm outline <notebook-id> <source-id>

# Generate text-based mindmap
nlm mindmap <notebook-id> <source-id>

# Create a timeline of events
nlm timeline <notebook-id> <source-id>

# Generate table of contents
nlm toc <notebook-id> <source-id>
```

### Research Commands

Research topics and automatically import sources into a notebook:

```bash
# Research a topic and import sources to a notebook
nlm research "quantum computing advances" --notebook <notebook-id>

# Deep research mode for comprehensive investigation
nlm research "climate policy impacts" --notebook <notebook-id> --deep
```

The research command:
- Searches for relevant sources on the topic
- Automatically imports found sources into the specified notebook
- `--deep` mode performs more comprehensive research

### Batch Operations

Execute multiple commands in a single request for better performance:

```bash
nlm batch "create 'Research Notebook'" "add NOTEBOOK_ID https://example.com" "add NOTEBOOK_ID paper.pdf"
```

## Workflows

For detailed workflow recipes (research, study materials, content analysis, executive briefing, Readwise→NLM import), read `references/workflows.md`.

Quick start — automated research:

```bash
id=$(nlm create "Topic Research" | grep -o 'notebook [^ ]*' | cut -d' ' -f2)
nlm research "your topic" --notebook $id
nlm generate-chat $id "What are the key findings?"
```

## Troubleshooting

- **Auth errors**: Run `nlm auth` to re-authenticate
- **Debug mode**: Add `-debug` flag for detailed API interactions
- **Browser profile**: Use `--profile “Profile Name”` to specify browser profile

## Environment Variables

- `NLM_AUTH_TOKEN`: Authentication token (managed by auth command)
- `NLM_COOKIES`: Authentication cookies (managed by auth command)
- `NLM_BROWSER_PROFILE`: Chrome/Brave profile to use (default: “Default”)
