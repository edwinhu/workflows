# Third-party review runners (advisory only)

Rules for the craft workflow's third-party runner agents. Each runner executes ONE external
CLI over the working-tree changes, parses the result, and returns the schema'd object
`{model, status, findings[], raw?}`. Findings are **advisory** — they never enter the gate.

Shared rules for both models:

- Run from the project directory. Modify no files.
- **Status before findings.** An unreachable CLI and a clean review both have empty findings —
  the `status` field is what distinguishes them:
  - `unavailable` — binary missing (`command -v` fails), auth error, network error, non-zero
    exit with no review content, or timeout.
  - `unparseable` — the CLI ran and produced output, but you cannot extract discrete findings.
    Put the last ~2000 chars of raw output in `raw`.
  - `reviewed` — the CLI ran and you parsed its review. Zero findings is a valid result.
- Timeout: give the CLI up to 10 minutes (`timeout 600 …`). A timeout is `unavailable`.
- Severity mapping when the CLI doesn't label severity: anything it calls a bug, correctness
  issue, or data-loss risk → `major`; style/naming/docs → `minor`; only use `critical` if the
  CLI itself flags something as severe/blocking.
- Never invent findings the CLI did not produce; never drop findings it did.

## codex

`codex review` is a native non-interactive reviewer; it computes the diff itself.

Diff scoping — pick exactly one:

- Uncommitted working-tree changes (the craft default; changes are left uncommitted):

  ```bash
  timeout 600 codex review --uncommitted --color never \
    "Review these changes for correctness, safety, and scope. Number each finding, cite file and line, and state severity (critical/major/minor)." 
  ```

- Changes already committed on a branch: `--base <branch>` instead of `--uncommitted`;
  a single commit: `--commit <sha>`.

Parse rules: the review arrives as prose/markdown on stdout (progress noise may precede it).
Extract each discrete issue into one finding: `severity` (from the CLI's own label, else the
shared mapping), `file` (path if cited), `detail` (the CLI's text for that issue, condensed but
faithful). Praise, summaries, and "LGTM" lines are not findings. If stdout has review content
but no extractable issues and no clean-bill statement, return `unparseable`.

## gemini

Runs via `agy` (Antigravity CLI — the gemini binary is sunset; `agy -p` is the one-shot mode).
`agy -p` has no repo/diff awareness, so you feed it the diff inline:

```bash
d=$(mktemp -d) && trap 'rm -rf "$d"' EXIT      # NOT a fixed /tmp path — see below
git diff HEAD > "$d/craft-review.diff"   # uncommitted changes; use the plan's diff scope if different
wc -c "$d/craft-review.diff"             # if > 200000 bytes, truncate per-file and say so in the prompt
timeout 600 agy -p "You are a code reviewer. Review the following unified diff for correctness, safety, and scope. Number each finding, cite file and line, state severity (critical/major/minor). If the diff is clean, say 'No findings.'

$(cat "$d/craft-review.diff")" --print-timeout 9m
```

**Why `mktemp -d` and not `/tmp/craft-review.diff`.** This file is read and followed by the
third-party leg, which under `readOnly` is pinned to `Explore` — no Edit, no Write, but `Bash`
survives, so a shell redirect in these instructions still lands on disk. A fixed path made that a
write the CALLER could not prevent: the caller passes the string `"gemini"`, not a command, so
there was nothing for them to scope. Both `SKILL.md`s described `readOnly`'s only residual as the
caller's own `mechanicalChecks` command; this was a second one, owned by the spine, and the
enumeration was wrong until it was scoped here. A fixed path is also two concurrent runs writing
the same file.

(`$(cat …)` inside a double-quoted Bash argument is the reliable way to embed the diff;
untracked new files aren't in `git diff HEAD` — append them with `git diff --no-index /dev/null <file>` if the plan's tasks created new files.)

Parse rules: same as codex — one finding per numbered/discrete issue, severity from the CLI's
label else the shared mapping. "No findings." → `reviewed` with empty findings. The `trap` removes
the scratch directory; there is no manual cleanup step to forget.
