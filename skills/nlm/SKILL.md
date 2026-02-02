---
name: nlm
description: This skill should be used when the user asks to “create a notebook”, “add source to notebook”, “generate audio overview”, “create podcast”, “manage NotebookLM”, “nlm”, “add PDF to notebook”, “list notebooks”, or needs to interact with Google NotebookLM via the nlm CLI tool.
version: 0.1.0
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
# Generate notebook guide
/Users/vwh7mb/projects/nlm/nlm generate-guide <notebook-id>

# Generate content outline
/Users/vwh7mb/projects/nlm/nlm generate-outline <notebook-id>

# Generate new section
/Users/vwh7mb/projects/nlm/nlm generate-section <notebook-id>

# Free-form chat generation
/Users/vwh7mb/projects/nlm/nlm generate-chat <notebook-id> “What are the main themes?”
```

### Batch Operations

Execute multiple commands in a single request for better performance:

```bash
/Users/vwh7mb/projects/nlm/nlm batch “create ‘Research Notebook’” “add NOTEBOOK_ID https://example.com” “add NOTEBOOK_ID paper.pdf”
```

## Common Workflows

### Research Workflow

1. Create a notebook for the topic
2. Add sources (URLs, PDFs, text)
3. Create notes with key findings
4. Generate an audio overview for synthesis

```bash
# Create notebook
id=$(/Users/vwh7mb/projects/nlm/nlm create “AI Research” | grep -o ‘notebook [^ ]*’ | cut -d’ ‘ -f2)

# Add sources
/Users/vwh7mb/projects/nlm/nlm add $id https://arxiv.org/paper.pdf
/Users/vwh7mb/projects/nlm/nlm add $id research-notes.txt

# Generate audio
/Users/vwh7mb/projects/nlm/nlm audio-create $id “Summarize the key findings professionally”
```

## Troubleshooting

- **Auth errors**: Run `/Users/vwh7mb/projects/nlm/nlm auth` to re-authenticate
- **Debug mode**: Add `-debug` flag for detailed API interactions
- **Browser profile**: Use `--profile “Profile Name”` to specify browser profile

## Environment Variables

- `NLM_AUTH_TOKEN`: Authentication token (managed by auth command)
- `NLM_COOKIES`: Authentication cookies (managed by auth command)
- `NLM_BROWSER_PROFILE`: Chrome/Brave profile to use (default: “Default”)
