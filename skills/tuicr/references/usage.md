# tuicr — Commands, Keybindings & the Agent Read/Write Contract

## Launch commands

| Goal | Command |
|---|---|
| Review a GitHub PR / GitLab MR | `tuicr pr <N> --no-update-check` (from inside the repo, or pass a PR/MR URL) |
| Uncommitted working tree | `tuicr -w --no-update-check` |
| A commit range / revset | `tuicr -r <revset> --no-update-check` (e.g. `-r main..HEAD`) |
| Every tracked file | `tuicr -A --no-update-check` |
| A single file/dir (no VCS needed) | `tuicr --file <path> --no-update-check` |
| Narrow a PR to one path | `tuicr pr <N> --path <path> --no-update-check` |
| Override the PR repo | `tuicr pr <N> --repo-url <url>` |

Always route launches through `scripts/launch-tuicr.sh` (real TTY needed). `--stdout` makes the
TUI's export print to stdout instead of copying to the clipboard.

## Keybindings (in the TUI)

From the status bar: `j`/`k` scroll · `{`/`}` prev/next file · `r` next file · `R` next hunk ·
`c` add a comment on the current line · `q` quit · `?` full help. Comments are entered inline and
saved into the session; export to GitHub or the clipboard is available from within the TUI.

## Agent read: `tuicr review comments`

```bash
tuicr review comments --session "<slug>"        # e.g. gh:edwinhu/workflows/pr/70
tuicr review comments --session /path/to/session.json
```

Prints a **clean JSON array**. Each element carries:

- `path` — file the note is on
- `start_line`, `end_line` — line range
- `side` — `new` or `old` (which side of the diff)
- `comment_type` — the note's classification
- `lifecycle_state` — `local_draft` for a note not yet exported to the forge
- `content` — the annotation text (this is what you classify and act on)
- plus a `location` descriptor

An empty array `[]` means no annotations (user quit clean).

## Agent write: `tuicr review add`

Writes a draft comment **into the same session the user sees in the TUI**. Always pass `--username`
so agent comments are visually distinguished from the human's:

```bash
tuicr review add --session "<slug>" --username "Claude Opus 4.8" --type note \
  --target-file src/app.rs --line 42 --end-line 45 --side new "your text"
```

- `--type note` (a comment) or `--type suggestion` (a concrete proposed edit). Default `note`.
- `--target-file` + `--line` (+ optional `--end-line`) place it on a line/range; `--side new|old`
  selects the diff side (default `new`). Omit `--target-file`/`--line` for a review-level note.
- `--input <JSON|@file|->` accepts a full JSON payload instead of flags.
- For a **local** (non-PR) session, add `--repo <path|owner/repo>` so the slug resolves.

### Deleting a draft you added

There is **no** `review remove` subcommand. To remove a draft comment (e.g. a test note), edit the
session JSON directly — its path is in `tuicr review list` — and drop the entry from
`review_comments`, or restore a backup. Prefer not adding throwaway comments to a real session.

## The agent loop

launch (pane) → user annotates → `review comments` (read) → classify (explanation vs code-change) →
address in code → optionally `review add` (reply) → relaunch → repeat until `[]`. This is a
superset of a one-way capture tool: tuicr is bidirectional and session-backed, so replies land back
in the user's live TUI.
