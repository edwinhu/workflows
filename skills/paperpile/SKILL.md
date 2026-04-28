---
name: paperpile
description: This skill should be used when the user asks to "add paper", "paperpile add", "fetch PDF for", "search paperpile", "find in paperpile", "paperpile search", "label paper", "trash paper", "download paper", "paperpile index", or any request to manage their Paperpile library.
version: 0.1.0
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
