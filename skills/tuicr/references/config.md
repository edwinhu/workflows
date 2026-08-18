# tuicr — Config, Themes & Session Storage

## Themes / appearance

- `--theme <name>` — a bundled theme (resolved first) or a local theme from the config `themes/`
  directory.
- `--appearance <light|dark|system>` — used when no explicit `--theme` is set.

Press `?` inside the TUI for the full keybinding help.

## Config directory

tuicr reads config from `~/.config/tuicr/` (created on demand; may not exist until you set
something). Local themes go in `~/.config/tuicr/themes/`. A `username` setting there is the default
author stamped on comments — the launcher/agent overrides it per-call with `--username` so agent
comments are visually distinct from yours in the TUI.

## Session storage (the important part for agents)

Every review persists to:

```
~/.local/share/tuicr/reviews/sessions/<hash>.json
```

- List them: `tuicr review list [--repo <path|owner/repo>] [--all]`
- Each row has: `slug` (e.g. `gh:edwinhu/workflows/pr/70`), `kind` (`pr`/local), `path` (the JSON
  file), `updated_at`, `comment_count`, `file_count`, `anchor` (e.g. `pr/70`), `active`.
- The session JSON top-level keys include: `id`, `repo_path`, `branch_name`, `base_commit`,
  `diff_source`, `commit_range`, `pr_session_key`, `review_comments`, `files`, `session_notes`,
  `created_at`, `updated_at`.

The **slug** is the handle you pass to `tuicr review comments --session <slug>` and
`tuicr review add --session <slug>`. `--session` also accepts a direct path to the JSON file. For a
local (non-PR) session you may need `--repo <path>` so the slug resolves; PR slugs and JSON paths
resolve on their own.

`scripts/resolve-session.sh` wraps `tuicr review list` to print the newest matching slug.
