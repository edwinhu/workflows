---
name: paperpile
description: This skill should be used when the user asks to "add paper", "paperpile add", "fetch PDF for", "search paperpile", "find in paperpile", "paperpile search", "label paper", "trash paper", "download paper", "paperpile index", "find PDF online", "search google for PDF", "browse PDF", or any request to manage their Paperpile library.
version: 0.2.0
user-invocable: false
---

# Paperpile CLI

Manage your Paperpile library via the `paperpile` CLI.

## Prerequisites

1. `paperpile` binary installed at `~/.local/bin/paperpile`
2. Cookies imported via `paperpile auth import <path>` (exported from Cookie-Editor in JSON format)
3. Run `paperpile auth` to verify authentication is working

## Quick Reference

| Need | Command |
|------|---------|
| Verify auth | `paperpile auth` |
| Import cookies | `paperpile auth import ~/cookies.json` |
| Index/refresh library | `paperpile index --refresh` |
| Search library | `paperpile search "proxy voting"` |
| Download PDF by item ID | `paperpile download <item_id>` |
| Fetch PDF by bibkey | `paperpile fetch Smith2024-ab` |
| Add paper by DOI | `paperpile add 10.1016/j.jfineco.2024.01.001` |
| Add stub (no metadata) | `paperpile add <doi> --force` |
| List labels | `paperpile label list` |
| Create label | `paperpile label create "My Label"` |
| Apply label | `paperpile label apply "My Label" Smith2024-ab` |
| Remove label | `paperpile label remove "My Label" Smith2024-ab` |
| Delete label | `paperpile label delete "My Label" --confirm` |
| Trash item | `paperpile trash Smith2024-ab --confirm` |
| Restore from trash | `paperpile trash Smith2024-ab --restore --confirm` |
| Find PDF via Paperpile UI | Select paper > Add PDF > Find PDF online (see Workflow A below) |
| Google search for PDF | Select paper > Add PDF > Search Google for PDF (see Workflow B below) |
| Poll for PDF attachment | `${CLAUDE_SKILL_DIR}/scripts/poll_attachment.sh <item_id>` |

## Key Behaviors

- **`add`** requires a DOI. Refuses to add stubs without the `--force` flag (Guru metadata required by default).
- **`fetch`** resolves a bibkey to a PDF via the Paperpile API + Google Drive download. Output is the path to the downloaded PDF.
- **`search`** scores against a local index cache. Run `paperpile index` first to populate/refresh.
- **`trash`** and **`label delete`** are dry-run by default -- pass `--confirm` to execute.

## Integration with Librarian Workflow

```
Paperpile (this skill) -- manage library items, fetch PDFs, search
  |
  v
librarian-fetch -- resolve bibkey to PDF (uses Paperpile as step 0a/0b)
  |
  v
cite-check -- upload PDFs to Gemini File Search store
```

## Auth Notes

- Cookies stored at `~/.claude-work/skills/librarian-fetch/cookies/<domain>.json`
- Shared with librarian-fetch skill (same cookie store)
- Re-import when cookies expire (Paperpile sessions last ~30 days)

## Red Flags -- STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|--------|-----------|------------|
| Using `--force` without user approval | Adds stubs without metadata -- clutters library | Ask user before adding without Guru data |
| Running `trash --confirm` without showing what will be trashed | Destructive, cannot be undone | Run without `--confirm` first (dry run) |
| Skipping `paperpile index` before search | Search uses cached index -- stale results | Run `paperpile index --refresh` first |
| Calling Paperpile API directly | Skips auth, cookies, error handling | Always use the CLI |

---

## Browser Automation: Find PDFs via Paperpile UI

When the CLI's `paperpile fetch` fails (no PDF attachment in library), use Paperpile's webapp UI to find PDFs through browser automation.

### Prerequisites

1. **Dia running with CDP on port 9222**: `curl -sf http://localhost:9222/json/version`
   - If not running: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.dia.cdp.plist`
2. **Paperpile open** at `https://app.paperpile.com/my-library/all` in Dia
3. **MCP chrome-devtools tools** available (`mcp__chrome-devtools__*`)

### Quick Reference (Browser)

| Need | Method |
|------|--------|
| Auto-find PDF for selected paper | Add PDF > **Find PDF online** (shortcut `D`) |
| Google search for PDF | Add PDF > **Search Google for PDF...** |
| Browse local file | Add PDF > Browse for PDF... (opens OS file picker) |
| Poll for PDF arrival | `${CLAUDE_SKILL_DIR}/scripts/poll_attachment.sh <item_id>` |

### Workflow A: Find PDF Online

**When**: Paper is in library, no PDF. This is fire-and-forget -- Paperpile's server-side auto-finder does the work.

1. `list_pages` -- find the Paperpile tab, `select_page`
2. `take_snapshot` -- find the paper row (papers without PDFs show NO "PDF" button)
3. `click` the paper row to select it -- the row expands to show "Website", "Cited by", **"Add PDF"** buttons
4. `click` the **"Add PDF"** button -- a menu appears with 4 options
5. `click` **"Find PDF online"** (first menuitem, shortcut D)
6. Paperpile searches in the background. The row status changes:
   - Success: "PDF" button and attachment count appear
   - Failure: "Not signed in to proxy" or similar message
7. **Verify**: `take_snapshot` after ~10s to check row status
8. **Confirm via API**: Run `${CLAUDE_SKILL_DIR}/scripts/poll_attachment.sh <item_id> --timeout 60`

**If "Not signed in to proxy"**: The institutional proxy session expired. Fall back to `librarian-fetch` skill which handles proxy authentication.

### Workflow B: Search Google for PDF

**When**: "Find PDF online" failed, OR you want to manually pick the best PDF source.

1. Select the paper in Paperpile (same as Workflow A steps 1-3)
2. `click` **"Add PDF"** > `click` **"Search Google for PDF..."** (last menuitem)
3. A **new tab** opens with Google search: `filetype:pdf <paper title>`
4. At the bottom of the Google page, a **Paperpile banner** appears:
   > "Browse for PDF -- Find the PDF link in the search results and click **Select PDF** to attach it automatically to [Author Year]."
   > [Close and cancel] button
5. **DECISION POINT** -- `select_page` to the new Google tab, `take_snapshot`:
   - Evaluate the search results (JSTOR, publisher site, SSRN, university repos)
   - **Prefer**: Publisher/JSTOR > university repos > SSRN > random PDFs
   - **Avoid**: Non-matching papers, suspicious domains
6. `click` the chosen PDF link -- Paperpile intercepts and attaches the PDF
7. **Verify**: Switch back to Paperpile tab, `take_snapshot` to confirm PDF badge appeared
8. **Confirm via API**: `${CLAUDE_SKILL_DIR}/scripts/poll_attachment.sh <item_id>`
9. **Cleanup**: Close the Google search tab

### Workflow C: Google Scholar Search (Discover New Papers)

**When**: User wants to find and add new papers by keywords (not by DOI).

Paperpile's Google Scholar search is already open in Dia (page 3 in tabs). Alternatively:

1. Navigate to `https://scholar.google.com` in Dia
2. `fill` the search box with the query, `press_key` Enter
3. `take_snapshot` to see results (title, authors, journal, year, citation count)
4. **DECISION POINT** -- evaluate which papers to add:
   - Cross-reference against `paperpile search` to avoid duplicates
   - Check journal quality against domain knowledge
   - Present ranked options to user for approval
5. For each approved paper:
   - Click the paper title to open its page
   - Look for Paperpile's browser extension "Add to Paperpile" button, or copy the DOI
   - If DOI available: use `paperpile add <doi>` (faster, more reliable)
   - `${CLAUDE_SKILL_DIR}/scripts/poll_attachment.sh <item_id>` to confirm PDF
6. Run `paperpile index --refresh` to sync local cache

### Paperpile UI Patterns (A11y Tree Reference)

**Paper row without PDF** (selected):
```
button "<title> ... <authors> <journal> · <year> · <type> · Website · Cited by Add PDF"
  checkbox checked          -- selection state
  link "Website"            -- DOI link
  link "Cited by"           -- Google Scholar citations link
  button "Add PDF"          -- triggers the PDF menu
```

**Add PDF menu** (4 items):
```
menu orientation="vertical"
  menuitem "Find PDF online D"       -- auto-finder (fire-and-forget)
  menuitem "Attach PDF... O"         -- local file picker
  menuitem "Browse for PDF..."       -- OS file dialog
  menuitem "Search Google for PDF..."-- opens Google search tab
```

**Paper row WITH PDF**:
```
button "<title> ... <authors> <journal> · <year> · <type> 1 PDF"
  button "1"                -- attachment count
  button "PDF"              -- open/download PDF
```

**Google Search tab (Paperpile banner at bottom)**:
```
StaticText "Browse for PDF"
StaticText "Find the PDF link in the search results and click "
StaticText "Select PDF"
StaticText " to attach it automatically to <Author Year>."
button "Close and cancel"
```

## Browser Automation Red Flags -- STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|--------|-----------|------------|
| Clicking "Add PDF" without selecting a paper first | Menu items will be disabled/missing | Click the paper row first, verify checkbox is checked |
| Using "Find PDF online" when proxy session is expired | Will fail with "Not signed in to proxy" | Fall back to librarian-fetch skill for proxy auth |
| Clicking random Google results without evaluating source | May attach wrong PDF or corrupted file | Prefer publisher/JSTOR/SSRN, verify title matches |
| Adding papers from Google Scholar without checking for duplicates | Creates duplicate library entries | Run `paperpile search` first |
| Forgetting to close the Google search tab after workflow | Tab accumulation clutters browser | Close tab after PDF is attached |
| Running browser workflows without Dia on port 9222 | All MCP tools will fail | Check `curl -sf http://localhost:9222/json/version` first |
