---
name: paperpile
description: This skill should be used when the user asks to "add paper", "paperpile add", "fetch PDF for", "search paperpile", "find in paperpile", "paperpile search", "label paper", "trash paper", "download paper", "paperpile index", "find PDF online", "search google for PDF", "browse PDF", "resolve PDF", "fetch PDF for citation", "institutional access", "proxy", "get full-text for DOI", "resolve cite to PDF", or any request to manage their Paperpile library or resolve a citation to a local PDF.
version: 0.3.0
user-invocable: false
---

# Paperpile

Unified library management and PDF resolution.

## Prerequisites

- `paperpile` binary at `~/.local/bin/paperpile`
- Cookies imported via `paperpile auth import <path>` (exported from Cookie-Editor in JSON format)
- For browser commands: Dia running with CDP on port 9222
- For resolve: `uv` installed, proxy config at `${CLAUDE_SKILL_DIR}/references/proxy_urls.md`

## Subcommands: Library Management

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

**Key behaviors:**

- **`add`** requires a DOI. Refuses stubs without `--force` (Guru metadata required by default).
- **`fetch`** resolves a bibkey to PDF via Paperpile API + Google Drive download. Output is the path to the downloaded PDF.
- **`search`** scores against a local index cache. Run `paperpile index` first to populate/refresh.
- **`trash`** and **`label delete`** are dry-run by default -- pass `--confirm` to execute.

## Subcommands: PDF Resolution

### find-pdf

**When**: Paper is in library but has no PDF (add didn't auto-fetch, or paper was added without DOI). Fire-and-forget -- Paperpile's server-side auto-finder does the work.

1. `list_pages` -- find the Paperpile tab, `select_page`
2. `take_snapshot` -- find the paper row (papers without PDFs show NO "PDF" button)
3. `click` the paper row to select it -- row expands to show "Website", "Cited by", **"Add PDF"** buttons
4. `click` **"Add PDF"** -- menu appears with 4 options
5. `click` **"Find PDF online"** (first menuitem, shortcut D)
6. Paperpile searches in background. Row status changes:
   - Success: "PDF" button and attachment count appear
   - Failure: "Not signed in to proxy" or similar
7. **Verify**: `take_snapshot` after ~10s to check row status
8. **Confirm via API**: `${CLAUDE_SKILL_DIR}/scripts/poll_attachment.sh <item_id> --timeout 60`

**If "Not signed in to proxy"**: Try `search-pdf` or `resolve --via-dia` instead.

### search-pdf

**When**: You want to manually pick the best PDF source from Google.

1. Select the paper in Paperpile (same as find-pdf steps 1-3)
2. `click` **"Add PDF"** > `click` **"Search Google for PDF..."** (last menuitem)
3. A **new tab** opens with Google search: `filetype:pdf <paper title>`
4. At the bottom of the Google page, a **Paperpile banner** appears:
   > "Browse for PDF -- Find the PDF link in the search results and click **Select PDF** to attach it automatically to [Author Year]."
5. **DECISION POINT** -- `select_page` to the new Google tab, `take_snapshot`:
   - **Prefer**: Publisher/JSTOR > university repos > SSRN > random PDFs
   - **Avoid**: Non-matching papers, suspicious domains
6. `click` the chosen PDF link -- Paperpile intercepts and attaches the PDF
7. **Verify**: Switch back to Paperpile tab, `take_snapshot` to confirm PDF badge
8. **Confirm via API**: `${CLAUDE_SKILL_DIR}/scripts/poll_attachment.sh <item_id>`
9. **Cleanup**: Close the Google search tab

### find-and-add

`paperpile find-and-add "<citation>" [--doi DOI] [--ssrn ID] [--title T] [--author A] [--year Y] [--journal J] [--volume V] [--page P] [--json] [--no-pdf]`

End-to-end: citation string → paper in Paperpile with PDF.

```bash
# Law review (HeinOnline)
paperpile find-and-add "Robertson, Passive in Name Only, 36 Yale J. on Reg. 795 (2019)"

# SSRN paper
paperpile find-and-add --ssrn 5093097

# Paper with known DOI
paperpile find-and-add --doi 10.1016/j.jfineco.2024.01.001
```

**Discovery chain**: DOI/SSRN provided → Guru title search → CrossRef → OpenAlex → HeinOnline URL construction (for law reviews with volume/page).

**Law review citations** with volume+page+known journal handle skip CrossRef entirely (unreliable for HeinOnline-only journals) and construct metadata from parsed citation fields.

**Supported journals**: UCLA L. Rev., Yale J. on Reg., Yale L.J., Harv. L. Rev., Stan. L. Rev., Colum. L. Rev., Mich. L. Rev., Va. L. Rev., U. Pa. L. Rev., and 15+ more (see `heinonline.ts` in paperpile-cli).

### resolve (last resort)

## IRON LAW: Always Use the Script

**NEVER hand-walk the resolver chain. ALWAYS call `resolve_pdf.py`. This is non-negotiable.**

```bash
"${CLAUDE_SKILL_DIR}/scripts/resolve_pdf.py" <BIBKEY> [--bib PATH] [--doi DOI] [--out PATH] [--via-dia] [--manual-hop] [--login-only]
```

Seven-tier chain:

| # | Method | Triggered when | Auth needed |
|---|--------|----------------|-------------|
| 0a | Paperpile API + Drive | Library has matching item with PDF | `plack_session` cookie |
| 0b | Paperpile local cache | API miss; Drive-synced filename match in `~/Google Drive/.../Paperpile/All Papers/<Letter>/` | None |
| 1 | LibKey / Third Iron | DOI present | LibKey institution cookie (UVA) |
| 2 | UVA EZproxy | LibKey misses or returns HTML | UVA NetBadge cookie |
| 3 | OpenAthens / publisher SSO | UVA returns "Not Authorized" for OpenAthens publisher (Elsevier, Wiley, Springer, OUP, T&F, Cambridge) | Publisher cookies + UVA SSO (`--via-dia` only) |
| 4 | NYU EZproxy | UVA + OpenAthens both fail | NYU NetID cookie |
| 5 | SSRN direct download | Working paper, `ssrn = {id}`, or DOI is `10.2139/ssrn.<id>` | SSRN session cookie (optional) |
| 6 | Virgo article search | No DOI available (e.g. older law reviews not in CrossRef) | UVA SSO (`--via-dia` only) |

**Flags:**

| Flag | Purpose |
|------|---------|
| `--bib PATH` | Path to `.bib` file for DOI/metadata extraction |
| `--doi DOI` | Override DOI when bib entry is missing one |
| `--out PATH` | Output directory (default: `/tmp/paperpile-resolve/`) |
| `--via-dia` | Use Dia browser cookies for proxy auth |
| `--manual-hop` | Open URL in Dia, poll for user to click Download (for Cloudflare-walled sources like SSRN) |
| `--login-only` | Warm up proxy session without resolving a paper |

**Exit codes:** 0=success, 1=config error, 2=no identifier, 3=all resolvers exhausted

**Output:** Absolute path to PDF on stdout. On failure, diagnostic line per resolver attempted.

**`--manual-hop` escape hatch**: For Cloudflare-walled sources (SSRN, Bloomberg, WSJ), opens the abstract URL in Dia and polls 120s for the PDF. User clicks "Download PDF" once; script auto-copies and returns the path.

**Examples:**

```bash
# Resolve from bib
"${CLAUDE_SKILL_DIR}/scripts/resolve_pdf.py" Brav2022-ht \
  --bib ~/Documents/Notes/Writing/mirror_voting/references/sources.bib

# Override DOI
"${CLAUDE_SKILL_DIR}/scripts/resolve_pdf.py" Brav2022-ht \
  --bib /path/to/sources.bib --doi 10.1016/j.jfineco.2022.01.005

# Raw DOI (no bib)
"${CLAUDE_SKILL_DIR}/scripts/resolve_pdf.py" --doi 10.1016/j.jfineco.2022.01.005

# Custom output directory
"${CLAUDE_SKILL_DIR}/scripts/resolve_pdf.py" Brav2022-ht --out ~/Downloads/nlm-feed/
```

## Subcommands: Discovery

### scholar-search

**When**: User wants to find and add new papers by keywords (not by DOI).

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

## Subcommands: Utilities

| Need | Command |
|------|---------|
| Poll for PDF attachment | `${CLAUDE_SKILL_DIR}/scripts/poll_attachment.sh <item_id>` |
| Warm up proxy session | `${CLAUDE_SKILL_DIR}/scripts/warmup.sh` |

## Integration

```
Paperpile (this skill) → cite-check (upload PDFs to Gemini)
                       → nlm (upload to NotebookLM)
```

## Auth & Data

- Cookies: `~/.claude-work/skills/paperpile/cookies/<domain>.json`
- Cache: `~/.claude-work/skills/paperpile/cache/paperpile-index.json`
- Proxy config: `${CLAUDE_SKILL_DIR}/references/proxy_urls.md`
- Re-import when cookies expire (~30 days)

## Paperpile UI Patterns (A11y Tree Reference)

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

## Red Flags -- STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|--------|-----------|------------|
| Hand-walking the resolver chain manually | Triples wall time, forgets cookie refresh, misses fallbacks | Call `resolve_pdf.py` -- it parallelizes + falls through automatically |
| Hitting `https://doi.org/<doi>` directly with `curl` | Publisher returns HTML paywall, not PDF | Use `resolve_pdf.py` -- it wraps with proxy + cookies |
| Using `scholar download` without going through resolve | Skips bib parsing and the LibKey/proxy chain | Call `resolve_pdf.py` |
| Using `--force` without user approval | Adds stubs without metadata -- clutters library | Ask user before adding without Guru data |
| Running `trash --confirm` without showing what will be trashed | Destructive, cannot be undone | Run without `--confirm` first (dry run) |
| Skipping `paperpile index` before search | Search uses cached index -- stale results | Run `paperpile index --refresh` first |
| Calling Paperpile API directly | Skips auth, cookies, error handling | Always use the CLI |
| Clicking "Add PDF" without selecting a paper first | Menu items will be disabled/missing | Click the paper row first, verify checkbox is checked |
| Clicking random Google results without evaluating source | May attach wrong PDF or corrupted file | Prefer publisher/JSTOR/SSRN, verify title matches |
| Adding papers from Google Scholar without checking for duplicates | Creates duplicate library entries | Run `paperpile search` first |
| Forgetting to close the Google search tab after workflow | Tab accumulation clutters browser | Close tab after PDF is attached |
| Running browser workflows without Dia on port 9222 | All MCP tools will fail | Check `curl -sf http://localhost:9222/json/version` first |
