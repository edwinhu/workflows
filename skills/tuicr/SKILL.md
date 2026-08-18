---
name: tuicr
description: Review a GitHub/GitLab PR, commit range, working tree, or file in the tuicr TUI and address the annotations in code, or answer questions about tuicr usage and config. Use when the user says "tuicr", "tuicr pr <N>", "review this PR", "review PR #N", "review with tuicr", "code review TUI", "review the working tree", "review changes with tuicr", "tuicr all files", "tuicr <file>", "review this file with tuicr", "address my tuicr annotations", "read my tuicr review", "what did I annotate in tuicr", "tuicr config", "tuicr keybindings".
argument-hint: 'optional: PR number/URL, "working tree", "all files", a revset, or a file path'
allowed-tools: [Bash, Read, Edit, Write, Grep, Glob]
---

# tuicr — TUI Code Review

Review a PR (or the working tree, a commit range, or a file) with inline annotations in the tuicr
TUI, then read the annotations back and address them. tuicr auto-detects the VCS. Unlike a one-way
capture tool, tuicr **persists the review session to disk** and exposes it to agents both ways:
Claude *reads* your notes with `tuicr review comments` and can *write* replies back into the same
session — that you see live in the TUI — with `tuicr review add`.

## Activation Triggers

- "tuicr", "review PR with tuicr", "tuicr pr 70", "review PR #123", "review this PR"
- "review the working tree", "review changes with tuicr", "tuicr working tree"
- "review commit range", "tuicr -r main..HEAD"
- "tuicr all files", "browse all files"
- "tuicr README.md", "tuicr docs/plan.md", "review this file with tuicr" — single-file review (`--file`)
- "address my tuicr annotations", "read my tuicr review", "what did I annotate in tuicr" — process an existing session
- "tuicr config", "tuicr keybindings", "how do tuicr sessions work" — informational

## Answering Questions

If the user asks *about* tuicr (config, sessions, keybindings, install) rather than requesting a
review, consult the reference files and answer directly — do **not** launch the TUI.

- `references/install.md` — how tuicr is installed (nixpkgs) and the launcher
- `references/config.md` — config file, themes, session storage
- `references/usage.md` — commands, keybindings, the agent read/write JSON contract

## Using an Existing Session

If the user says "read my tuicr review", "address the annotations I just made", "what did I flag" —
they ran tuicr outside this flow and want the stored annotations processed. Skip the launch: resolve
the session slug (Step 3) and go straight to Step 3.5 classification.

## How It Works

1. Launch tuicr in **its own herdr tab** (it needs a real TTY), revealed once the diff has painted.
2. The user navigates the diff and adds inline annotations (`c`), then quits (`q`).
3. On quit, the launcher unblocks. Annotations live in the persisted session on disk — NOT on stdout.
4. Claude reads them with `tuicr review comments --session <slug>`, classifies, and addresses each.
5. Optionally Claude replies into the session with `tuicr review add` (stamped as the agent).
6. Loop: re-launch so the user can see fixes and add more; done when there are no new annotations.

## Workflow

### Step 0: Verify Installation

```bash
command -v tuicr && tuicr --version
herdr tab list       # the launcher hosts the TUI in a herdr tab; this confirms a live server
```

If missing, tuicr is in nixpkgs — add `tuicr` to `~/nix/modules/shared/packages.nix` and rebuild
(`cd ~/nix && nix run .#build-switch`), or for a one-off run set
`TUICR=$(nix build --no-link --print-out-paths nixpkgs#tuicr)/bin/tuicr`. See `references/install.md`.

### Step 1: Determine the Review Target

Map `$ARGUMENTS` to tuicr's flags (always append `--no-update-check`):

| User intent | tuicr args |
|---|---|
| PR number `70` / PR or MR URL | `pr 70` (run from inside the repo, or pass the URL) |
| "working tree" / uncommitted | `-w` |
| commit range / revset | `-r <revset>` (e.g. `-r main..HEAD`) |
| "all files" | `-A` |
| a file/dir path (`docs/plan.md`) | `--file docs/plan.md` |
| a PR, narrowed to one path | `pr 70 --path src/app.rs` |

If nothing is specified and the repo has uncommitted changes, default to `-w`; on a clean feature
branch, offer `-r <main>..HEAD`. Ask only when genuinely ambiguous.

### Step 2: Launch the Review

The launcher opens tuicr in a new **herdr tab** (labeled `tuicr`), and blocks until the user quits.
The tab is created *unfocused* and revealed only once tuicr has painted, so it appears already
loaded rather than as a blank shell. Run it in the repo directory:

```bash
"${CLAUDE_SKILL_DIR}/scripts/launch-tuicr.sh" pr 70 --no-update-check
```

**IMPORTANT — long-running command**: it blocks for the whole review. Set the Bash tool `timeout`
to the maximum your harness allows (e.g. `1800000`). Do **not** use `run_in_background`. On a clean
quit the launcher prints `TUICR_RC=0`.

- tuicr needs a real TTY, so the launcher runs it in a fresh herdr pane (`herdr tab create` +
  `herdr pane run`) — running tuicr inline or with the `!` prefix fails with `No such device or
  address (os error 6)`. Always go through the launcher.
- The review lands in its own tab, so it never takes over the tab Claude is in. When the user quits
  tuicr (`q`), the launcher returns and closes the review tab.
- ghostty is only a **fallback**, used when no herdr server is reachable (or `jq` is missing). Don't
  assume ghostty is installed — herdr is the supported path.
- Launcher exit codes: `1` = tuicr not on PATH, `2` = no herdr server *and* no ghostty.

**If the Bash tool times out** before the launcher returns, tuicr is still open. Do NOT relaunch.
Tell the user "let me know when you've quit tuicr", then continue at Step 3 once they reply.

### Step 3: Read the Annotations

Resolve the session slug for what you just reviewed, then read its comments:

```bash
# slug for the most-recently-updated session in this repo (PR slugs look like gh:owner/repo/pr/70):
"${CLAUDE_SKILL_DIR}/scripts/resolve-session.sh"            # newest session for the cwd repo
"${CLAUDE_SKILL_DIR}/scripts/resolve-session.sh" 70         # narrow to a PR number

tuicr review comments --session "gh:edwinhu/workflows/pr/70"
```

`tuicr review comments` prints a clean JSON array. Each item carries `path`, `start_line`,
`end_line`, `side` (`new`/`old`), `comment_type`, `lifecycle_state` (`local_draft` for un-exported
notes), and `content`. An empty array (`[]`) means the user quit without annotating → go to Step 7.
See `references/usage.md` for the exact schema.

### Step 3.5: Classify Annotations

Split each annotation's `content` into two buckets (case-insensitive):

- **Explanation request** — contains `??` (two or more `?`) anywhere, OR starts with `explain`,
  `remind`, `describe`, `what is`, `what are`, `how does`, `how do`, `clarify`. The user wants an
  answer, not a code change.
- **Code-change directive** — everything else.

**For explanation requests:** answer each (read the referenced code, write a clear explanation) and
reply into the session so the answer shows up in the TUI next to the note:

```bash
tuicr review add --session "<slug>" --username "Claude Opus 4.8" --type note \
  --target-file src/app.rs --line 42 --side new "Explanation: this mutex guards the write path because …"
```

Then relaunch (Step 6) so the user can read the reply and follow up. Carry any code-change
directives from the same batch forward to Step 4.

**If all annotations are code-change directives**, go straight to Step 4.

### Step 4: Plan Changes

Enter plan mode (EnterPlanMode). List each code-change annotation with its `path:line` and the
change you propose. Get approval before editing code.

### Step 5: Address Annotations

After approval, edit the source. Each annotation is a directive — fix the actual code at
`path`/`start_line`.

### Step 5.5: (Optional) Reply Into the Session

When a reply is useful (you deviated from the request, or want to note what you did), write it back
so it appears in the TUI, stamped as the agent:

```bash
tuicr review add --session "<slug>" --username "Claude Opus 4.8" --type note \
  --target-file src/app.rs --line 42 --side new "Done — switched to errors.Is(); kept the wrap for context."
```

Use `--type suggestion` for a concrete proposed edit, `--type note` for a comment. Omit
`--target-file/--line` for a review-level note. There is **no** `review remove` subcommand — to
delete a draft you added, edit the session JSON directly (path is in `tuicr review list`).

### Step 6: Loop

Relaunch with the same target so the user sees the fixes and can add more annotations:

```bash
"${CLAUDE_SKILL_DIR}/scripts/launch-tuicr.sh" pr 70 --no-update-check
```

Read the session again (Step 3). New annotations → back to Step 3.5. No new annotations → Step 7.

> **Fact — for a PR review, do NOT `git push` the PR branch until the review loop is done.**
> tuicr keys a PR session by the PR's current `head_sha`. Pushing new commits moves the head, so the
> next `tuicr pr <N>` opens a *fresh* session and the prior annotations + your replies are orphaned
> (the data survives in the old `sessions/*.json` but is unlinked from `pr <N>` — the user just sees
> an empty review). Local commits are safe; only **pushing** moves the head. So relaunch to show
> replies, gather follow-ups, and close the loop *first*; push once. Telling the user their notes are
> "in the TUI" after a push, when the reopen shows nothing, is worse than not replying at all.

### Step 7: Done

When `tuicr review comments` returns `[]` (or only notes you already addressed), the review is
complete. Tell the user. If they want to publish, tuicr can export to GitHub or the clipboard from
the TUI (or `--stdout` to print) — see `references/usage.md`.

## Example Session

```
User: "review PR 70 with tuicr"
→ launch-tuicr.sh pr 70 --no-update-check   (opens tuicr in a new herdr tab, focused)
→ user annotates handler.rs:43 "use errors.Is() instead of ==", quits
→ resolve-session.sh 70 → gh:edwinhu/workflows/pr/70
→ tuicr review comments --session gh:edwinhu/workflows/pr/70 → [{path:"handler.rs",start_line:43,content:"use errors.Is()…"}]
→ classify: code-change directive
→ plan mode: "handler.rs:43 — replace == with errors.Is()"; user approves
→ edit handler.rs
→ tuicr review add --session … --username "Claude Opus 4.8" --target-file handler.rs --line 43 "Done — errors.Is()."
→ relaunch pr 70 → user sees fix + reply, quits without new annotations
→ review complete
```
