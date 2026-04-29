---
name: paperpile
description: This skill should be used when the user asks to "add paper", "paperpile add", "fetch PDF for", "find and add", "search paperpile", "find in paperpile", "paperpile search", "label paper", "trash paper", "download paper", "paperpile index", "find PDF online", "search google for PDF", "resolve PDF", "fetch PDF for citation", "get full-text for DOI", "resolve cite to PDF", or any request to manage their Paperpile library or resolve a citation to a local PDF.
version: 0.4.0
user-invocable: false
---

# Paperpile

Manage your Paperpile library and resolve citations to PDFs via the `paperpile` CLI.

## Prerequisites

- `paperpile` binary at `~/.local/bin/paperpile` (Bun-compiled from `~/projects/paperpile-cli`)
- Cookies imported via `paperpile auth import <path>` (exported from Cookie-Editor in JSON format)
- For PDF resolution: Dia running with CDP on port 9222 (`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.dia.cdp.plist`)

## Library Management

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
- **`add`** requires a DOI. Refuses stubs without `--force`.
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

## Utilities

| Need | Command |
|------|---------|
| Poll for PDF attachment | `${CLAUDE_SKILL_DIR}/scripts/poll_attachment.sh <item_id>` |
| Warm up proxy session | `${CLAUDE_SKILL_DIR}/scripts/warmup.sh` |

`warmup.sh` auto-clicks the NetBadge cert login via CDP. Runs every 25 min via launchd (`com.paperpile.warmup.plist`).

## Integration

```
Paperpile (this skill) → cite-check (upload PDFs to Gemini)
                       → nlm (upload to NotebookLM)
```

## Auth & Data

- Cookies: `~/.claude-work/skills/paperpile/cookies/<domain>.json`
- Cache: `~/.claude-work/skills/paperpile/cache/paperpile-index.json`
- Paperpile All Papers: `~/Library/CloudStorage/GoogleDrive-eddyhu@gmail.com/My Drive/resources/Paperpile/All Papers/`
- Re-import cookies when they expire (~30 days for Paperpile, ~8-12h for Shibboleth hard expiry)

## Red Flags -- STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|--------|-----------|------------|
| Using `--force` without user approval | Adds stubs without metadata -- clutters library | Ask user before adding without Guru data |
| Running `trash --confirm` without showing dry run | Destructive, cannot be undone | Run without `--confirm` first |
| Skipping `paperpile index` before search | Stale results from cached index | Run `paperpile index --refresh` first |
| Calling Paperpile API directly | Skips auth, cookies, error handling | Always use the CLI |
| Using `curl` to fetch a DOI URL | Publisher returns HTML paywall, not PDF | Use `paperpile find-and-add --doi` |
| Running find-and-add without Dia on :9222 | CDP PDF fallbacks will fail | Check `curl -sf http://localhost:9222/json/version` first |
