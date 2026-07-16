---
name: paperpile
description: This skill should be used when the user asks to "add paper", "paperpile add", "fetch PDF for", "find and add", "search paperpile", "find in paperpile", "paperpile search", "label paper", "trash paper", "download paper", "paperpile index", "edit paper metadata", "update paper title", "fix paper author", "paperpile edit", "find PDF online", "search google for PDF", "resolve PDF", "fetch PDF for citation", "get full-text for DOI", "resolve cite to PDF", or any request to manage their Paperpile library or resolve a citation to a local PDF.
version: 0.5.0
user-invocable: false
---

# Paperpile

Manage your Paperpile library and resolve citations to PDFs via the `paperpile` CLI.

**CLI-first — this is the whole point of the skill.** Every library operation (add, search,
fetch, label, edit, trash, auth) goes through the `paperpile` CLI, which is pure HTTP. **Never
drive the Paperpile web app (app.paperpile.com) via browser automation** to add or manage
references — it is slower, the React forms reject synthetic input, and the CLI already does it.
If the CLI fails, it is almost always stale auth — refresh cookies (below), do not reach for the browser.

## Prerequisites

- `paperpile` binary at `~/.local/bin/paperpile` (Bun-compiled from `~/projects/paperpile-cli`)
- Valid auth cookies. If `paperpile auth` fails, **refresh them automatically** (no manual
  Cookie-Editor export needed): `${CLAUDE_SKILL_DIR}/scripts/refresh-auth-from-dia.sh` pulls the
  cookies from the logged-in browser over CDP (:9222 — Dia on macOS, Chromium on Linux),
  imports them, and verifies.
- For PDF resolution: Chrome running with CDP on port 9250 (dedicated instance at `~/.config/chrome-cdp`)

## Library Management

| Need | Command |
|------|---------|
| Verify auth | `paperpile auth` |
| Import cookies | `paperpile auth import ~/cookies.json` |
| Index/refresh library | `paperpile index --refresh` |
| Search library | `paperpile search "proxy voting"` |
| Download PDF by item ID | `paperpile download <item_id>` |
| Fetch PDF by bibkey | `paperpile fetch Smith2024-ab` |
| Add by DOI | `paperpile add 10.1016/j.jfineco.2024.01.001` |
| Add web source by URL | `paperpile add https://example.com/article` |
| Add remote PDF | `paperpile add https://example.com/report.pdf` |
| Add local PDF | `paperpile add /path/to/report.pdf` |
| Add DOI stub (no metadata) | `paperpile add <doi> --force` |
| List labels | `paperpile label list` |
| Create label | `paperpile label create "My Label"` |
| Apply label | `paperpile label apply "My Label" Smith2024-ab` |
| Remove label | `paperpile label remove "My Label" Smith2024-ab` |
| Delete label | `paperpile label delete "My Label" --confirm` |
| Trash item | `paperpile trash Smith2024-ab --confirm` |
| Restore from trash | `paperpile trash Smith2024-ab --restore --confirm` |
| Edit metadata | `paperpile edit Smith2024-ab --title "..." --author "..." --year 2024 --confirm` |

**Key behaviors:**
- **`add`** auto-detects input type:
  - **DOI** (`10.xxx`) -- lookup metadata via Guru, create entry
  - **Web URL** (`https://...`) -- create entry with `url:[]` field (no `--force` needed)
  - **Remote PDF URL** (`https://.../*.pdf`) -- download PDF, copy to Google Drive, attach to entry
  - **Local PDF** (`/path/to/*.pdf`) -- copy to Google Drive sync folder, create entry with PDF attached
  - All modes accept `--title`, `--author`, `--year`, `--pubtype` for metadata
  - `--force` only needed for DOIs when Guru metadata is unavailable
- **`edit`** updates metadata fields on existing items via sync API. Dry-run by default -- pass `--confirm` to apply.
- **`fetch`** resolves a bibkey to PDF via Paperpile API + Google Drive download.
- **`search`** scores against a local index cache. Run `paperpile index` first.
- **`trash`** and **`label delete`** are dry-run by default -- pass `--confirm` to execute.

## Find and Add

**One command: citation string → paper in Paperpile with PDF.**

```bash
paperpile find-and-add "<citation>" [--doi DOI] [--ssrn ID] [--title T] [--author A] [--year Y] [--journal J] [--volume V] [--page P] [--json] [--no-pdf]
```

### Examples

```bash
# Law review article (HeinOnline)
paperpile find-and-add "Robertson, Passive in Name Only, 36 Yale J. on Reg. 795 (2019)"

# SSRN working paper
paperpile find-and-add --ssrn 5093097

# Paper with known DOI
paperpile find-and-add --doi 10.1016/j.jfineco.2024.01.001

# Multi-author law review
paperpile find-and-add "Montagnes, Peskowitz and Sridharan, How Well Do Voting Choice Policies Represent Public and Investor Preferences, SSRN 5093097 (2024)"
```

### What it does

1. **Parse** citation string → extract author, title, journal, volume, page, year, DOI, SSRN ID
2. **Discover** metadata: Guru title search → CrossRef → OpenAlex (law reviews skip CrossRef — too many false positives)
3. **Dedup** against cached library index
4. **Add** to Paperpile via POST /api/library
5. **Get PDF** (automatic, no manual steps):
   - Guru `pdf_url` preprint/publisher download (pure HTTP)
   - HeinOnline via UVA EZproxy CDP (law reviews with volume/page/known journal)
   - EZproxy/OpenAthens/SSRN via native CDP
   - Google `filetype:pdf` search via CDP (final fallback)
6. **Copy** PDF to Paperpile Google Drive sync folder (`~/Google Drive/.../Paperpile/All Papers/<Letter>/`)

### Supported law review journals (HeinOnline)

UCLA L. Rev., Yale J. on Reg., Yale L.J., Harv. L. Rev., Stan. L. Rev., Colum. L. Rev., Mich. L. Rev., Va. L. Rev., U. Pa. L. Rev., N.Y.U. L. Rev., Chi. L. Rev., Geo. L.J., Duke L.J., Cornell L. Rev., Nw. U. L. Rev., Tex. L. Rev., B.U. L. Rev., and more (see `heinonline.ts` in paperpile-cli).

### Key design decisions

- **Law review citations** with volume+page+known journal handle skip CrossRef entirely (unreliable for HeinOnline-only journals) and construct metadata from parsed citation fields
- **Paperpile's PDF crawler runs in the browser extension**, not server-side -- neither POST /api/library nor POST /api/sync triggers it. PDF resolution is always active (CDP or HTTP).
- **Guru title search** works for finance/econ journals but returns 0 for law reviews (HeinOnline-only)
- **Shibboleth cookies** (`shibidp.its.virginia.edu`) are now snapshotted -- EZproxy re-auth is transparent across Dia restarts

## Edit Metadata

**Update title, author, year, and other fields on existing library items.**

```bash
paperpile edit <bibkey-or-_id> --title "..." --author "..." --year 2024 [--confirm]
```

Supported flags: `--title`, `--author`, `--year`, `--journal`, `--volume`, `--issue`, `--pages`, `--abstract`, `--url`, `--doi`, `--publisher`, `--language`, `--pubtype`, `--citekey`

### Examples

```bash
# Edit title and year (dry-run)
paperpile edit Smith2024-ab --title "New Title" --year 2025

# Apply the edit
paperpile edit Smith2024-ab --title "New Title" --year 2025 --confirm

# Institutional author (& treated as single author)
paperpile edit abc123 --author "Davis Polk & Wardwell" --confirm

# Multiple personal authors (comma-separated "First Last" pairs)
paperpile edit abc123 --author "Jack Pitcher, Emily Glazer" --confirm

# Set a DOI (e.g. after a PDF-first add mangled the metadata)
paperpile edit abc123 --doi "10.1111/jofi.12422" --confirm

# SSRN working paper: real DOI is 10.2139/ssrn.<abstract_id> + the abstract URL
paperpile edit abc123 --doi "10.2139/ssrn.666962" \
  --url "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=666962" --confirm
```

**Fixing PDF-first metadata damage:** `paperpile add <local.pdf>` lets Paperpile's
server-side PDF-text extractor populate metadata, which often drops co-authors,
blanks the year, or duplicates the title. Prefer DOI-first adds. To repair an
existing entry, set the correct DOI and repopulate authoritatively from Paperpile's
own Guru resolver rather than hand-typing every field. SSRN papers **do** have real
DOIs (`10.2139/ssrn.<abstract_id>`), but they resolve to *preprint* metadata — safe
for genuine working papers, but don't attach them to a version that was later
published (it regresses the journal/volume/page citation).

**Key behaviors:**
- Dry-run by default -- shows what would change without applying. Pass `--confirm` to mutate.
- Resolves bibkeys to pub `_id` via the local index (same as trash).
- Uses POST /api/sync?v=3 with `action: "update"` to patch fields.
- Author strings with `&` are treated as institutional (single author). Comma-separated "First Last" pairs are split into multiple personal authors.

## Utilities

| Need | Command |
|------|---------|
| Poll for PDF attachment | `${CLAUDE_SKILL_DIR}/scripts/poll_attachment.sh <item_id>` |
| Warm up proxy session | `${CLAUDE_SKILL_DIR}/scripts/warmup.sh` |

`warmup.sh` auto-clicks the NetBadge cert login via CDP. Runs every 25 min via launchd (`com.paperpile.warmup.plist`).

## WRDS SOCKS Tunnel (preferred for PDF acquisition)

If the `/fetch-paper` skill is available (lives in dotfiles, not this plugin), prefer it
for downloading paywalled PDFs. It uses a WRDS SOCKS tunnel to present a Penn IP — which
is registered with publishers for IP-based access — and bypasses EZproxy entirely.

**Check availability:**
```bash
which wrds-tunnel && which fetch-paper-browser && echo "fetch-paper available" || echo "fetch-paper not available — falling back to EZproxy/CDP"
```

If available: use `/fetch-paper` for PDF acquisition, then `paperpile add <local.pdf>` to add to library.
If not available: use the EZproxy/CDP pipeline in `find-and-add` as before.

See `${CLAUDE_SKILL_DIR}/references/institutional_access.md` for technical details.

## Integration

```
fetch-paper (dotfiles) → download PDF via WRDS SOCKS
Paperpile (this skill) → cite-check (upload PDFs to Gemini)
                       → nlm (upload to NotebookLM)
```

## Auth & Data

- Cookies: `~/.claude-work/skills/paperpile/cookies/<domain>.json`
- Cache: `~/.claude-work/skills/paperpile/cache/paperpile-index.json`
- Paperpile All Papers: `~/Library/CloudStorage/GoogleDrive-eddyhu@gmail.com/My Drive/resources/Paperpile/All Papers/`
- Cookies expire (~30 days for Paperpile, ~8-12h for Shibboleth hard expiry). To refresh, run
  `${CLAUDE_SKILL_DIR}/scripts/refresh-auth-from-dia.sh` — it extracts the live cookies from the
  logged-in browser via CDP (:9222 — Dia on macOS, Chromium on Linux) and `paperpile auth import`s
  them (no Cookie-Editor export). Requires being logged into Paperpile in that browser; if not, log
  in there first.

## Red Flags

| Action | Why Wrong | Do Instead |
|--------|-----------|------------|
| About to drive the Paperpile **web app** (app.paperpile.com) via browser automation — CDP clicks, the Add → "Paste references" dialog, filling React forms | The `paperpile` CLI does every library op over HTTP. The web UI is slower and its React forms silently reject synthetic input (you'll wrestle a textarea that never registers). This is the #1 trap — reaching for the browser when a one-word CLI command exists. | Use the CLI (`paperpile add <doi\|url\|pdf>`). If it errors on auth, run `scripts/refresh-auth-from-dia.sh`, then retry. |
| Using `--force` without user approval | Adds DOI stubs without metadata -- clutters library | Ask user before adding DOIs without Guru data. URLs and PDFs don't need `--force` |
| Running `trash --confirm` without showing dry run | Destructive, cannot be undone | Run without `--confirm` first |
| Skipping `paperpile index` before search | Stale results from cached index | Run `paperpile index --refresh` first |
| Calling Paperpile API directly | Skips auth, cookies, error handling | Always use the CLI |
| Using `curl` to fetch a DOI URL | Publisher returns HTML paywall, not PDF | Use `paperpile find-and-add --doi` |
| Running find-and-add without Chrome on :9250 | CDP PDF fallbacks will fail | Check `curl -sf http://localhost:9250/json/version` first |
