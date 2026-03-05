# NLM Command Reference

Full command catalog for the `nlm` CLI tool.

## Content Transformation Commands

All transformation commands take `<notebook-id> <source-id> [source-id...]`:

| Command | Description |
|---------|-------------|
| `nlm summarize` | Summarize content from sources |
| `nlm study-guide` | Generate study guide with key concepts and review questions |
| `nlm faq` | Generate FAQ from sources |
| `nlm briefing-doc` | Create professional briefing document |
| `nlm rephrase` | Rephrase content in different words |
| `nlm expand` | Expand on content with more detail |
| `nlm critique` | Get a critique of the content |
| `nlm brainstorm` | Brainstorm ideas from sources |
| `nlm verify` | Verify facts in sources |
| `nlm explain` | Explain concepts in accessible language |
| `nlm outline` | Create a structured outline from sources |
| `nlm mindmap` | Generate text-based mindmap |
| `nlm timeline` | Create a timeline of events |
| `nlm toc` | Generate table of contents |

### Examples

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

## Video Commands

```bash
# Create video overview
nlm video-create <notebook-id> "Instructions for video"

# List video overviews
nlm video-list <notebook-id>

# Download video (requires --direct-rpc)
nlm video-download <notebook-id> output.mp4 --direct-rpc
```

## Batch Operations

Execute multiple commands in a single request for better performance:

```bash
nlm batch "create 'Research Notebook'" "add NOTEBOOK_ID https://example.com" "add NOTEBOOK_ID paper.pdf"
```
