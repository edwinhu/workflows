---
name: gemini-web
description: This skill should be used when the user asks to “use Gemini deep research”, “research with Gemini”, “add paper to Gemini”, “use Paperpile extension”, “create deep research report”, “Gemini web”, or needs browser automation for Gemini Advanced or NotebookLM web with Paperpile integration.
version: 0.1.0
---

# Gemini Web Automation

Browser automation for Gemini Advanced deep research mode and Paperpile extension integration.

## Overview

This skill provides Python/CDP automation for:
1. **Gemini Advanced** (`gemini.google.com`) - Deep research reports with citations
2. **Paperpile Integration** - Finding and clicking Paperpile extension buttons

**Scripts location:** `${CLAUDE_PLUGIN_ROOT}/skills/gemini-web/scripts/`

## Prerequisites

1. **Chrome browser** with user logged into Google account
2. **Paperpile browser extension** installed (optional, for citation capture)
3. **Python dependencies:**
   ```bash
   pip install playwright
   playwright install chromium
   ```

## Setup

### First-Time Setup

1. Start Chrome with remote debugging:
   ```bash
   ${CLAUDE_PLUGIN_ROOT}/skills/gemini-web/scripts/chrome_launcher.sh start
   ```

2. In Chrome, navigate to `gemini.google.com` and log in with your Google account.

3. Verify connection:
   ```bash
   python ${CLAUDE_PLUGIN_ROOT}/skills/gemini-web/scripts/gemini_client.py status
   ```

Browser data is stored in `~/.browser-automation/` to persist logins across sessions.

## Scripts Reference

### chrome_launcher.sh

Manages Chrome with CDP debugging enabled.

```bash
# Start Chrome
${CLAUDE_PLUGIN_ROOT}/skills/gemini-web/scripts/chrome_launcher.sh start

# Check status
${CLAUDE_PLUGIN_ROOT}/skills/gemini-web/scripts/chrome_launcher.sh status

# Stop Chrome
${CLAUDE_PLUGIN_ROOT}/skills/gemini-web/scripts/chrome_launcher.sh stop

# Restart Chrome
${CLAUDE_PLUGIN_ROOT}/skills/gemini-web/scripts/chrome_launcher.sh restart
```

### gemini_client.py

Python client for Gemini automation.

```bash
# Check connection status
python ${CLAUDE_PLUGIN_ROOT}/skills/gemini-web/scripts/gemini_client.py status

# Run deep research
python ${CLAUDE_PLUGIN_ROOT}/skills/gemini-web/scripts/gemini_client.py research “topic here”

# Run deep research with custom timeout and output file
python ${CLAUDE_PLUGIN_ROOT}/skills/gemini-web/scripts/gemini_client.py research “shareholder activism” --timeout 600 --output research.txt

# Find Paperpile buttons on page
python ${CLAUDE_PLUGIN_ROOT}/skills/gemini-web/scripts/gemini_client.py paperpile
```

## Deep Research Workflow

### Automated Workflow

1. **Ensure Chrome is running:**
   ```bash
   ${CLAUDE_PLUGIN_ROOT}/skills/gemini-web/scripts/chrome_launcher.sh start
   ```

2. **Run deep research:**
   ```bash
   python ${CLAUDE_PLUGIN_ROOT}/skills/gemini-web/scripts/gemini_client.py research “SEC disclosure requirements for shareholder activism” --output /tmp/research.txt
   ```

3. **Use the output:**
   - Add to NotebookLM: `nlm new-note <notebook-id> “Research: Topic”`
   - Save to file for further processing

### What the Research Script Does

1. Connects to Chrome via CDP (port 9222)
2. Opens or reuses existing Gemini tab
3. Verifies user is logged in
4. Enters a structured research prompt
5. Waits for Gemini to generate response (up to 5 minutes)
6. Extracts and returns the response text

## Paperpile Integration

The Paperpile browser extension adds citation buttons to various sites. Use the client to find these buttons:

```bash
# Find Paperpile elements on current Gemini page
python ${CLAUDE_PLUGIN_ROOT}/skills/gemini-web/scripts/gemini_client.py paperpile
```

For interactive Paperpile clicking, use Claude in Chrome MCP tools as fallback:
```
mcp__claude-in-chrome__find query=”Paperpile” tabId=<id>
mcp__claude-in-chrome__computer action=left_click ref=”<ref_id>” tabId=<id>
```

## Integration with NotebookLM

Combine Gemini research with NotebookLM:

```bash
# 1. Run deep research
python ${CLAUDE_PLUGIN_ROOT}/skills/gemini-web/scripts/gemini_client.py research “topic” --output /tmp/research.txt

# 2. Create notebook
notebook_id=$(/Users/vwh7mb/projects/nlm/nlm create “Topic Research” | grep -o ‘notebook [^ ]*’ | cut -d’ ‘ -f2)

# 3. Add research as a source
cat /tmp/research.txt | /Users/vwh7mb/projects/nlm/nlm add $notebook_id - -mime=”text/plain”

# 4. Generate audio overview
/Users/vwh7mb/projects/nlm/nlm audio-create $notebook_id “Summarize the key findings”
```

## Troubleshooting

### Chrome not running
```bash
${CLAUDE_PLUGIN_ROOT}/skills/gemini-web/scripts/chrome_launcher.sh start
```

### Not logged in
1. Check status: `python gemini_client.py status`
2. If `logged_in: false`, manually log into Gemini in Chrome
3. The browser data in `~/.browser-automation/` persists logins

### Connection refused
- Verify Chrome is running on port 9222
- Check: `curl http://localhost:9222/json/version`
- Restart Chrome if needed

### Timeout during research
- Deep research can take 1-5 minutes
- Increase timeout: `--timeout 600` (10 minutes)
- Check Gemini web UI directly if stuck

### Paperpile not found
- Ensure Paperpile extension is installed in Chrome
- Extension must be enabled for gemini.google.com
- Try refreshing the page

## Environment

- **Browser data:** `~/.browser-automation/`
- **CDP port:** 9222
- **Default timeout:** 300 seconds (5 minutes)
