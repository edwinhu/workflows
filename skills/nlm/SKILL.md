---
name: nlm
description: This skill should be used when the user asks to "create a notebook", "add source to notebook", "generate audio overview", "create podcast", "manage NotebookLM", "nlm", "add PDF to notebook", "list notebooks", "summarize sources", "generate study guide", "create FAQ", "briefing document", "chat with notebook", "generate outline", "research a topic", "deep research", or needs to interact with Google NotebookLM via the nlm CLI tool.
version: 0.2.0
---

# NotebookLM CLI (nlm)

Manage Google NotebookLM notebooks, sources, notes, and audio overviews via the `nlm` command-line tool.

**Binary Path:** `/Users/vwh7mb/projects/nlm/nlm`

## Authentication

Before first use, authenticate with Google:

```bash
/Users/vwh7mb/projects/nlm/nlm auth
```

This launches a browser for OAuth. Credentials are stored in `~/.nlm/env`.

To check available browser profiles:
```bash
/Users/vwh7mb/projects/nlm/nlm auth --all --notebooks
```

## Core Commands

### Notebook Management

```bash
# List all notebooks
/Users/vwh7mb/projects/nlm/nlm list

# Create a new notebook
/Users/vwh7mb/projects/nlm/nlm create “Research Notes”

# Delete a notebook
/Users/vwh7mb/projects/nlm/nlm rm <notebook-id>

# Get notebook analytics
/Users/vwh7mb/projects/nlm/nlm analytics <notebook-id>
```

### Source Management

Add sources from URLs, files, or stdin:

```bash
# Add URL source
/Users/vwh7mb/projects/nlm/nlm add <notebook-id> https://example.com/article

# Add PDF file
/Users/vwh7mb/projects/nlm/nlm add <notebook-id> document.pdf

# Add from stdin
echo “Some text content” | /Users/vwh7mb/projects/nlm/nlm add <notebook-id> -

# Add with specific MIME type
cat data.json | /Users/vwh7mb/projects/nlm/nlm add <notebook-id> - -mime=”application/json”

# Add YouTube video
/Users/vwh7mb/projects/nlm/nlm add <notebook-id> https://www.youtube.com/watch?v=VIDEO_ID

# List sources in notebook
/Users/vwh7mb/projects/nlm/nlm sources <notebook-id>

# Rename a source
/Users/vwh7mb/projects/nlm/nlm rename-source <source-id> “New Title”

# Remove a source
/Users/vwh7mb/projects/nlm/nlm rm-source <notebook-id> <source-id>

# Refresh source content
/Users/vwh7mb/projects/nlm/nlm refresh-source <source-id>
```

### Note Management

```bash
# List notes in notebook
/Users/vwh7mb/projects/nlm/nlm notes <notebook-id>

# Create new note
/Users/vwh7mb/projects/nlm/nlm new-note <notebook-id> “Note Title”

# Update note content
/Users/vwh7mb/projects/nlm/nlm update-note <notebook-id> <note-id> “New content” “New Title”

# Remove note
/Users/vwh7mb/projects/nlm/nlm rm-note <note-id>
```

### Audio Overviews

Generate AI podcast-style audio summaries:

```bash
# Create audio overview with instructions
/Users/vwh7mb/projects/nlm/nlm audio-create <notebook-id> “Focus on key themes and provide a professional summary”

# List audio overviews
/Users/vwh7mb/projects/nlm/nlm audio-list <notebook-id>

# Get audio overview status/content
/Users/vwh7mb/projects/nlm/nlm audio-get <notebook-id>

# Download audio file (requires --direct-rpc)
/Users/vwh7mb/projects/nlm/nlm audio-download <notebook-id> output.mp3 --direct-rpc

# Share audio (private)
/Users/vwh7mb/projects/nlm/nlm audio-share <notebook-id>

# Share audio (public)
/Users/vwh7mb/projects/nlm/nlm audio-share <notebook-id> --public

# Delete audio
/Users/vwh7mb/projects/nlm/nlm audio-rm <notebook-id>
```

### Video Overviews

```bash
# Create video overview
/Users/vwh7mb/projects/nlm/nlm video-create <notebook-id> “Instructions for video”

# List video overviews
/Users/vwh7mb/projects/nlm/nlm video-list <notebook-id>

# Download video (requires --direct-rpc)
/Users/vwh7mb/projects/nlm/nlm video-download <notebook-id> output.mp4 --direct-rpc
```

### Generation Commands

```bash
# Generate notebook guide (short summary)
/Users/vwh7mb/projects/nlm/nlm generate-guide <notebook-id>

# Generate comprehensive content outline
/Users/vwh7mb/projects/nlm/nlm generate-outline <notebook-id>

# Generate new content section
/Users/vwh7mb/projects/nlm/nlm generate-section <notebook-id>

# Free-form chat generation
/Users/vwh7mb/projects/nlm/nlm generate-chat <notebook-id> "What are the main themes?"

# Interactive chat session
/Users/vwh7mb/projects/nlm/nlm chat <notebook-id>

# Generate magic view synthesis from specific sources
/Users/vwh7mb/projects/nlm/nlm generate-magic <notebook-id> <source-id-1> <source-id-2>
```

### Content Transformation Commands

Transform your sources into different formats. All commands take `<notebook-id> <source-id> [source-id...]`:

```bash
# Summarize content from sources
/Users/vwh7mb/projects/nlm/nlm summarize <notebook-id> <source-id>

# Generate study guide with key concepts and review questions
/Users/vwh7mb/projects/nlm/nlm study-guide <notebook-id> <source-id>

# Generate FAQ from sources
/Users/vwh7mb/projects/nlm/nlm faq <notebook-id> <source-id>

# Create professional briefing document
/Users/vwh7mb/projects/nlm/nlm briefing-doc <notebook-id> <source-id>

# Rephrase content in different words
/Users/vwh7mb/projects/nlm/nlm rephrase <notebook-id> <source-id>

# Expand on content with more detail
/Users/vwh7mb/projects/nlm/nlm expand <notebook-id> <source-id>

# Get a critique of the content
/Users/vwh7mb/projects/nlm/nlm critique <notebook-id> <source-id>

# Brainstorm ideas from sources
/Users/vwh7mb/projects/nlm/nlm brainstorm <notebook-id> <source-id>

# Verify facts in sources
/Users/vwh7mb/projects/nlm/nlm verify <notebook-id> <source-id>

# Explain concepts in accessible language
/Users/vwh7mb/projects/nlm/nlm explain <notebook-id> <source-id>

# Create a structured outline from sources
/Users/vwh7mb/projects/nlm/nlm outline <notebook-id> <source-id>

# Generate text-based mindmap
/Users/vwh7mb/projects/nlm/nlm mindmap <notebook-id> <source-id>

# Create a timeline of events
/Users/vwh7mb/projects/nlm/nlm timeline <notebook-id> <source-id>

# Generate table of contents
/Users/vwh7mb/projects/nlm/nlm toc <notebook-id> <source-id>
```

### Research Commands

Research topics and automatically import sources into a notebook:

```bash
# Research a topic and import sources to a notebook
/Users/vwh7mb/projects/nlm/nlm research "quantum computing advances" --notebook <notebook-id>

# Deep research mode for comprehensive investigation
/Users/vwh7mb/projects/nlm/nlm research "climate policy impacts" --notebook <notebook-id> --deep
```

The research command:
- Searches for relevant sources on the topic
- Automatically imports found sources into the specified notebook
- `--deep` mode performs more comprehensive research

### Batch Operations

Execute multiple commands in a single request for better performance:

```bash
/Users/vwh7mb/projects/nlm/nlm batch "create 'Research Notebook'" "add NOTEBOOK_ID https://example.com" "add NOTEBOOK_ID paper.pdf"
```

## Common Workflows

### Research Workflow

**Option A: Automated Research (recommended)**

Use the `research` command to automatically find and import sources:

```bash
# Create notebook
id=$(/Users/vwh7mb/projects/nlm/nlm create "AI Research" | grep -o 'notebook [^ ]*' | cut -d' ' -f2)

# Research and auto-import sources
/Users/vwh7mb/projects/nlm/nlm research "transformer architecture advances 2024" --notebook $id

# For comprehensive investigation
/Users/vwh7mb/projects/nlm/nlm research "transformer architecture advances 2024" --notebook $id --deep

# Generate synthesis
/Users/vwh7mb/projects/nlm/nlm generate-chat $id "What are the key findings?"
/Users/vwh7mb/projects/nlm/nlm audio-create $id "Summarize the key findings professionally"
```

**Option B: Manual Source Addition**

1. Create a notebook for the topic
2. Add sources manually (URLs, PDFs, text)
3. Create notes with key findings
4. Generate an audio overview for synthesis

```bash
# Create notebook
id=$(/Users/vwh7mb/projects/nlm/nlm create "AI Research" | grep -o 'notebook [^ ]*' | cut -d' ' -f2)

# Add sources manually
/Users/vwh7mb/projects/nlm/nlm add $id https://arxiv.org/paper.pdf
/Users/vwh7mb/projects/nlm/nlm add $id research-notes.txt

# Generate audio
/Users/vwh7mb/projects/nlm/nlm audio-create $id "Summarize the key findings professionally"
```

### Study Materials Workflow

Generate comprehensive study materials from sources:

```bash
# Get notebook and source IDs
/Users/vwh7mb/projects/nlm/nlm list
/Users/vwh7mb/projects/nlm/nlm sources <notebook-id>

# Generate study materials from a source
/Users/vwh7mb/projects/nlm/nlm study-guide <notebook-id> <source-id>  # Key concepts + review questions
/Users/vwh7mb/projects/nlm/nlm faq <notebook-id> <source-id>          # Common questions answered
/Users/vwh7mb/projects/nlm/nlm outline <notebook-id> <source-id>      # Structured overview
/Users/vwh7mb/projects/nlm/nlm explain <notebook-id> <source-id>      # Accessible explanations
```

### Content Analysis Workflow

Deeply analyze and transform content:

```bash
# Summarize and synthesize
/Users/vwh7mb/projects/nlm/nlm summarize <notebook-id> <source-id>
/Users/vwh7mb/projects/nlm/nlm generate-magic <notebook-id> <src1> <src2>  # Cross-source synthesis

# Critical analysis
/Users/vwh7mb/projects/nlm/nlm critique <notebook-id> <source-id>
/Users/vwh7mb/projects/nlm/nlm verify <notebook-id> <source-id>

# Creative exploration
/Users/vwh7mb/projects/nlm/nlm brainstorm <notebook-id> <source-id>
/Users/vwh7mb/projects/nlm/nlm expand <notebook-id> <source-id>

# Interactive Q&A
/Users/vwh7mb/projects/nlm/nlm chat <notebook-id>
```

### Executive Briefing Workflow

Create professional documents from sources:

```bash
# Generate briefing materials
/Users/vwh7mb/projects/nlm/nlm briefing-doc <notebook-id> <source-id>  # Executive summary + recommendations
/Users/vwh7mb/projects/nlm/nlm timeline <notebook-id> <source-id>      # Chronological overview
/Users/vwh7mb/projects/nlm/nlm toc <notebook-id> <source-id>           # Structure overview
```

## Troubleshooting

- **Auth errors**: Run `/Users/vwh7mb/projects/nlm/nlm auth` to re-authenticate
- **Debug mode**: Add `-debug` flag for detailed API interactions
- **Browser profile**: Use `--profile “Profile Name”` to specify browser profile

## Environment Variables

- `NLM_AUTH_TOKEN`: Authentication token (managed by auth command)
- `NLM_COOKIES`: Authentication cookies (managed by auth command)
- `NLM_BROWSER_PROFILE`: Chrome/Brave profile to use (default: “Default”)
