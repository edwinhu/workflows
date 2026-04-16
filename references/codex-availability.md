# Codex Availability Probe & Adversarial Review Invocation

Shared reference for skills that delegate adversarial review to the Codex plugin
when available, with graceful fallback to in-process Claude reviewers.

## Locate the Codex companion script

The Codex plugin installs to `~/.claude/plugins/cache/openai-codex/codex/<version>/scripts/codex-companion.mjs`.
Skills should resolve the newest installed version dynamically, since the version
segment changes on plugin updates.

```bash
CODEX_SCRIPT=$(find "$HOME/.claude/plugins/cache/openai-codex/codex" -maxdepth 3 -name codex-companion.mjs -type f 2>/dev/null | sort -rV | head -1)
```

If `$CODEX_SCRIPT` is empty, the Codex plugin is not installed → fall back.

**Why `find` instead of glob:** Plain shell globs behave differently in
bash vs zsh when no match exists (zsh errors by default). `find` is portable
and handles missing directories silently. `sort -rV` picks the highest
semver version directory.

## Probe readiness

```bash
[ -n "$CODEX_SCRIPT" ] && node "$CODEX_SCRIPT" setup --json 2>/dev/null
```

The JSON response includes:

| Field           | Meaning                                              |
|-----------------|------------------------------------------------------|
| `ready`         | `true` only when node + npm + codex CLI + auth all OK|
| `codex.available` | Codex CLI is on PATH                               |
| `auth.loggedIn` | ChatGPT/API auth is live                             |

**Codex is usable for adversarial review only when `ready === true`.**

If `ready` is `false`, do NOT prompt the user to install — just fall back to
the existing Claude-based reviewer path silently. The skill's job is to use
Codex when present, not to onboard it.

## Invoke adversarial review

```bash
# Foreground (small diffs, < ~3 files)
node "$CODEX_SCRIPT" adversarial-review --wait

# Background (anything bigger or unclear)
node "$CODEX_SCRIPT" adversarial-review --background
```

Scope flags mirror `/codex:adversarial-review`:

- `--scope auto` (default) — picks working-tree or branch based on git state
- `--scope working-tree` — uncommitted + untracked
- `--scope branch` — committed delta vs base branch
- `--base <ref>` — base branch override (e.g. `main`)

Optional trailing focus text is preserved verbatim — use it to inject SPEC.md
context (e.g. `"focus: REQ-AUTH-01 token rotation"`).

### Choosing wait vs background

Use the same heuristic as `/codex:adversarial-review`:

```bash
# Working-tree review
git status --short --untracked-files=all
git diff --shortstat --cached
git diff --shortstat

# Branch review
git diff --shortstat <base>...HEAD
```

Wait when the diff is clearly tiny (1-2 files, no untracked dir-sized changes).
Otherwise launch in background and inform the user to check `/codex:status`.

## Parse the verdict

The companion emits a structured payload validated against
`schemas/review-output.schema.json` (in the Codex plugin). Top-level fields:

| Field        | Meaning                                              |
|--------------|------------------------------------------------------|
| `verdict`    | `"approve"` or `"needs-attention"`                   |
| `summary`    | Terse ship/no-ship assessment                        |
| `findings[]` | Each has `severity`, `title`, `body`, `file`, `line_start`, `line_end`, `confidence` (0-1), `recommendation` |
| `next_steps[]` | Suggested follow-ups                               |

### Mapping to dev-review verdicts

| Codex verdict     | Map to               | Notes                                                                          |
|-------------------|----------------------|--------------------------------------------------------------------------------|
| `approve`         | `APPROVED`           | Proceed to dev-verify                                                          |
| `needs-attention` with any finding `confidence >= 0.8` | `CHANGES_REQUIRED` | Forward findings to dev-implement                       |
| `needs-attention` with all findings `confidence < 0.8` | `APPROVED` (with note) | Below the dev-review iron-law threshold — log findings to LEARNINGS.md as advisory |

This preserves the **iron law of review**: only issues with confidence ≥ 80
block. Codex reports confidence as 0-1 floats; multiply by 100 when displaying.

### Trace findings to requirements

Codex's adversarial prompt does NOT know about SPEC.md REQ-IDs. After
receiving the JSON, the calling skill is responsible for:

1. Reading `.planning/SPEC.md`
2. Tagging each finding with the most likely REQ-ID (or `OUT-OF-SPEC`)
3. Treating `OUT-OF-SPEC` findings as advisory unless the user opts in

## Fallback Decision Tree

```
Codex script located?
├── No  → Fallback: Single or Parallel Claude reviewer (existing flow)
└── Yes → Probe `setup --json`
          ├── ready: false → Fallback (silently)
          └── ready: true  → Offer Codex adversarial as RECOMMENDED option
                              (user can still pick Claude path if preferred)
```

## Iteration tracking

Codex adversarial review participates in the same `REVIEW_STATE.md` loop as
Claude reviewers — increment iteration on `CHANGES_REQUIRED`, escalate at
iteration 3. Re-runs go through Codex again (not a swap to Claude mid-loop)
unless Codex becomes unavailable between runs.
