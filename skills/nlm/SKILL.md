---
name: nlm
description: ALWAYS use for ANY NotebookLM work - "make me a notebook on X", "create a notebook", "add this PDF/source to the notebook", "what notebooks do I have", "make a podcast/audio overview of these", "generate a video overview", "study guide", "briefing doc", "FAQ from these sources", "outline from the notebook", "slide deck from these sources", "ask my notebook about X", "summarize the sources in there", or any mention of NotebookLM or `nlm`. Use even when the user says "make a podcast of these papers" without naming NotebookLM. NOT for open-web research reports - use deep-research instead.
version: 0.3.0
user-invocable: false
---

# NotebookLM CLI (nlm)

Manage Google NotebookLM notebooks, sources, notes, chat, and generated content (audio/video overviews, slide decks, apps, reports) via the `nlm` command-line tool.

**Requires:** `nlm` on PATH (nix-managed, built from upstream `tmc/nlm`). Install/update via `cd ~/nix && nix run .#build-switch`.

**Check:** `command -v nlm || echo "MISSING: nlm CLI not installed"`

**IRON LAW: gate on `nlm source list` before believing an empty chat answer.** With expired auth
the two chat paths fail differently and NEITHER says "auth": `nlm chat <id> "…"` prints nothing and
**exits 0**, and `nlm generate-chat <id> "…"` prints `empty response from API; check 'nlm sources
…' for source state`. Only the non-chat commands surface `exit-class=auth (exit 3)`. So an agent
that runs only a chat command reads an auth failure as "the notebook has nothing on this topic" —
measured 2026-08-23, and the likely cause of a 366-line Bluebook reference being written from style
guides while its author believed the notebook had been consulted. Run `nlm source list <id>` and
require exit 0 first; an empty chat answer is evidence of nothing until you have.

> **Command structure:** the CLI uses **subcommand groups** — `nlm <group> <action>` (e.g. `nlm notebook list`, `nlm source add`, `nlm audio create`). The older flat aliases (`nlm list`, `nlm add`, `nlm audio-create`, …) were removed in upstream's parser migration. When unsure of exact syntax, run `nlm --help` or `nlm <group> --help` — it's authoritative. The `references/*.md` files predate the migration and may be stale.

## Authentication

Before first use, authenticate with Google:

```bash
nlm auth login -all
```

This connects to Chrome via CDP (Chrome DevTools Protocol) to extract cookies from an active NotebookLM session. Credentials are stored in `~/.nlm/env`.

### Troubleshooting Authentication

If `nlm auth` fails with "no valid profiles found" or "SESSION_COOKIE_INVALID":

1. **Verify Chrome is running with remote debugging**:
   ```bash
   ps aux | grep -E "chrome.*remote-debugging-port=9400"
   ```
   If not running, Chrome needs to be started with `--remote-debugging-port=9400`.

2. **Test CDP connection**: `curl http://localhost:9400/json/version` (should return Chrome version JSON).

3. **Re-authenticate with debug**: `nlm auth login -debug -all` (shows which profiles are checked and why).

4. **Verify**: `nlm notebook list` should list notebooks without errors.

You can also point at a remote CDP socket: `nlm auth login -cdp-url ws://localhost:9222`, or pick a Google account index with `-authuser 1`.

## Core Commands

### Notebooks

```bash
nlm notebook list
nlm notebook create "Research Notes"
nlm notebook rename <nb-id> "New Title"
nlm notebook delete <nb-id>
nlm notebook description <nb-id> [text]    # text via arg or stdin; empty clears
nlm notebook emoji <nb-id> <emoji>
nlm notebook featured                      # list featured notebooks
nlm analytics <nb-id>                      # usage time series
```

### Sources

```bash
nlm source list <nb-id>
nlm source add <nb-id> <file|url|-> [more...]   # '-' streams stdin as one source
nlm source add <nb-id> https://www.youtube.com/watch?v=VIDEO_ID
nlm source rename <source-id> "New Name"
nlm source delete <nb-id> <source-id|a,b,c|->   # '-' reads newline-delimited IDs from stdin
nlm source refresh <nb-id> <source-id>
nlm source read <source-id> [nb-id]             # print the server-indexed text body
nlm source sync <nb-id> [paths...]              # bundle local files into a synced txtar source (auto-chunks at 5MB)
nlm discover-sources <nb-id> "query"            # discover relevant sources
```

### Notes

```bash
nlm note list <nb-id>
nlm note read <nb-id> <note-id>
nlm note create <nb-id> "Title" ["content"]     # content via arg or stdin
nlm note update <nb-id> <note-id> "content" "Title"
nlm note delete <nb-id> <note-id>
```

### Chat & research

```bash
nlm generate-chat <nb-id> "What are the main themes?"   # one-shot, streamed
nlm chat <nb-id> ["prompt"]                             # interactive; one-shot if a prompt is given
nlm chat <nb-id> -f prompt.txt                          # read a long prompt from file ('-' = stdin)
nlm chat <nb-id> --source-match <regex>                 # focus on matching sources (also --source-ids, --label-match, --citations)
nlm research <nb-id> "query" --mode=fast|deep [--md]    # research + import sources (NOTE: notebook-id comes FIRST)
```

### Source → output transforms

All take `<nb-id> [source-id...]` (omit source ids to use all sources):

| Command | Purpose |
|---------|---------|
| `summarize` / `briefing-doc` | Summary / professional briefing |
| `study-guide` / `faq` | Key concepts + review questions / FAQ |
| `outline` / `toc` / `timeline` | Outline / table of contents / timeline |
| `rephrase` / `expand` / `explain` | Reword / elaborate / simplify |
| `critique` / `verify` | Critique / fact-check |
| `brainstorm` | Ideate from sources |
| `mindmap <nb-id> <source-id> [...]` | Interactive mindmap (opens in browser) |

```bash
nlm summarize <nb-id>
nlm study-guide <nb-id> <source-id-1> <source-id-2>
```

### Audio & video overviews

```bash
nlm audio create <nb-id> "Focus on key themes, professional tone"   # alias: nlm create-audio
nlm audio list <nb-id>
nlm audio get <nb-id>
nlm audio download <nb-id> [output.mp3]
nlm audio share <nb-id> [--public]
nlm audio delete <nb-id>
nlm audio-suggestions <nb-id>                  # blueprint ideas as JSON lines (pipe to create-audio)

nlm video create <nb-id> "instructions"
nlm video list <nb-id>
nlm video get <nb-id>
nlm video download <nb-id> [output.mp4]
```

### Slide decks, apps, reports (added upstream)

```bash
# Slide decks → exportable as PDF / PPTX
nlm deck create [--format detailed|presenter] <nb-id> ["instructions"]
nlm deck download <nb-id> --id <artifact-id> [--format pdf|pptx] [--output file]

# Interactive app artifacts
nlm app create --type prototype|mindmap|canvas <nb-id> ["instructions"]
nlm mindmap create <nb-id> ["instructions"]

# Reports
nlm report-suggestions <nb-id>                 # list valid report types
nlm create-report <nb-id> <report-type> [description] [instructions]
nlm generate-report <nb-id> [--sections ...]

# Manage any generated artifact (decks, apps, reports, etc.)
nlm artifact list <nb-id>
nlm artifact get <artifact-id>
nlm artifact update <artifact-id> [new-title]
nlm artifact delete <artifact-id>
```

### Labels (autolabel clusters)

```bash
nlm label list <nb-id>
nlm label generate <nb-id>                     # recompute clusters
nlm label create <nb-id> <name> [emoji]
nlm label attach <nb-id> <label-id> <source-id>
nlm label unlabeled <nb-id>                    # apply existing labels to unlabeled sources
```

### Sharing & other

```bash
nlm share <nb-id>                              # share publicly
nlm share-private <nb-id>                      # share privately
nlm generate-guide <nb-id>                     # notebook guide (short summary)
nlm magic <nb-id> [source-id...]               # notebook 'Magic View' synthesis
nlm mcp                                        # run the MCP server on stdin/stdout
nlm account                                    # show/set the authenticated NotebookLM account
nlm refresh                                    # refresh stored auth credentials
```

**Exit codes:** `0` ok · `2` bad args · `3` auth required/invalid · `4` not found · `5` precondition (quota, source cap, wrong type) · `6` transient (rate limit/5xx) · `7` busy (still generating).

## Workflows

For longer recipes (research → study materials, content analysis, Readwise→NLM import), see `references/workflows.md` (note: predates the parser migration — translate flat commands to the subcommand form above).

Quick start — automated research:

```bash
id=$(nlm notebook create "Topic Research")        # capture the new notebook id from output
nlm research "$id" "your topic" --mode=deep
nlm generate-chat "$id" "What are the key findings?"
```

## Troubleshooting

- **Auth errors (exit 3)**: `nlm auth login -all` to re-authenticate; `nlm refresh` to refresh credentials.
- **Debug mode**: add `-debug` for detailed API interaction logs.
- **Resource busy (exit 7)**: generation (audio/video/deck/report) is async — re-run the `get`/`list`/`artifact get` command until it's ready.
- **Authoritative syntax**: `nlm --help` and `nlm <group> --help` always reflect the installed binary.

## Environment Variables

- `NLM_AUTH_TOKEN`: Authentication token (managed by the auth command)
- `NLM_COOKIES`: Authentication cookies (managed by the auth command)
- `NLM_BROWSER_PROFILE`: Chrome/Brave profile to use (default: "Default")
- `NLM_AUTHUSER`: Google account index for multi-account profiles
