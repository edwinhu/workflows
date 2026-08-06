# Codex Availability Probe & Second-Pass Review Invocation

Shared reference for review skills that run an optional **Codex second pass** —
an independent adversarial review that runs *after* the primary Claude reviewer
approves, and *before* the phase writes its APPROVED verdict.

Consumed by `skills/dev-verify/SKILL.md` and `skills/ds-accept/SKILL.md`.

## The second pass is additive, never a substitute

Codex does not replace the Claude reviewer. A Codex-instead-of-Claude review
leaves the diff reviewed exactly once, which is the single-reviewer blind spot
the second pass exists to close. The order is fixed:

```
primary Claude review (single | parallel)
        │
        ├── CHANGES_REQUIRED / ESCALATE / BLOCKED → fix loop (no second pass)
        │
        └── APPROVED (candidate verdict)
                 │
                 └── Codex second pass  ← optional, opt-in, this reference
                          │
                          ├── approve → write status: APPROVED → verify phase
                          └── needs-attention (≥0.8) → CHANGES_REQUIRED → fix loop
```

**Why a different model family:** this is `skills/audit-fix-loop/SKILL.md` Iron
Law 1 — "the auditor must not be the fixer" — applied to the model itself. A
Claude reviewer auditing Claude's code shares its training and therefore its
blind spots. Codex runs out-of-process on a different model family, so its
misses are uncorrelated. Two reviewers that fail the same way are one reviewer.

**Where it sits relative to the gate:** `.planning/REVIEW_STATE.md`'s
`status: APPROVED` is the structural gate that dev-accept / ds-verify hook on.
The second pass therefore runs BEFORE that line is written. A second pass that
ran after the gate was already open would be decorative.

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

Always `--json`, always redirected to a file:

```bash
node "$CODEX_SCRIPT" adversarial-review --wait --json \
  > .planning/codex-second-pass-iter[N].json 2> .planning/codex-second-pass-iter[N].err
```

The handle is **per-iteration** and is `rm -f`'d before the state records
`requested`. A single reused path can be joined while it still holds the
*previous* pass's verdict — the redirect only truncates it at launch, so a stop
between the state write and the invocation leaves last iteration's `approve`
sitting there to be parsed as this one's answer.

**`--json` is not optional.** It is the only form carrying `confidence`; the
rendered text prints `[high]` with no number, so the >= 0.8 iron law below has
nothing to read without it.

**The redirect is not optional either.** It is what makes a detached run
joinable: the file is the handle, and it survives an interruption that a
terminal buffer or transcript does not.

**Background is the harness's job, not the companion's.** `--background` is a
no-op for reviews — `adversarial-review` always runs in the foreground (only the
`task` subcommand enqueues a tracked job), so nothing is holding a result for a
later `/codex:status` fetch. To detach, run the SAME `--wait --json` command
through `Bash(..., run_in_background: true)` and join via the file.

### The join (this step is mandatory)

A launch is not a verdict. Clear the per-iteration handle **and verify the clear
worked**, record `codex_second_pass: requested` + `codex_output_file:` (the exact
path), invoke, then join by resolving that recorded path — never a hardcoded one:

```bash
OUT=.planning/codex-second-pass-iter[N].json
rm -f "$OUT"
[ -e "$OUT" ] && { echo "BLOCKED: cannot clear $OUT"; exit 1; }
```

`rm -f` is quiet both when the file never existed and when it could not be
removed, and nothing checks its exit status by default. A silently-failed clear
means the launch redirect fails too and the previous envelope survives to be
joined as this pass's answer — so successful invalidation is a *precondition* for
recording `requested`, not a hope. If it fails, record `error` / `status:
BLOCKED` instead.

```bash
uv run python3 - <<'PY'
import json, pathlib
import re
state = pathlib.Path('.planning/REVIEW_STATE.md')
m = re.search(r'^codex_output_file:\s*(\S+)\s*$', state.read_text(), re.M) if state.exists() else None
if not m:
    print('ERROR: no codex_output_file recorded'); raise SystemExit(0)
p = pathlib.Path(m.group(1))          # the handle THIS pass owns
if not p.exists() or not p.stat().st_size:
    print('PENDING'); raise SystemExit(0)
try:
    envelope = json.loads(p.read_text())
    if envelope.get('codex', {}).get('status') != 0:
        print('ERROR: exit', envelope.get('codex', {}).get('status')); raise SystemExit(0)
    v = json.loads(envelope['codex']['stdout'])
except Exception as e:
    print('ERROR:', e); raise SystemExit(0)
print(v['verdict'], [(f['confidence'], f['title']) for f in v.get('findings', [])])
PY
```

The payload is an envelope — `{review, target, threadId, codex: {status, stdout}}`
— and `codex.stdout` is the schema-validated verdict **as a JSON string**, so it
takes a second parse. Only after a verdict is parsed may the skill move
`SECOND_PASS_PENDING` to a terminal state, in ONE write.

`PENDING` on a resumed session means the run never finished: relaunch. The gate
stays shut throughout, because `requested` does not admit verify.

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

### Mapping to review verdicts

Identical in dev-verify and ds-accept; the implement/verify phase names differ.

| Codex verdict     | Map to               | Notes                                                                          |
|-------------------|----------------------|--------------------------------------------------------------------------------|
| `approve`         | `APPROVED`           | Write `status: APPROVED`, proceed to the verify phase                          |
| `needs-attention` with any finding `confidence >= 0.8` | `CHANGES_REQUIRED` | Forward findings to the implement phase             |
| `needs-attention` with all findings `confidence < 0.8` | `APPROVED` (with note) | Below the iron-law threshold — log findings to LEARNINGS.md as advisory |

This preserves the **iron law of review**: only issues with confidence ≥ 80
block. Codex reports confidence as 0-1 floats; multiply by 100 when displaying.

**A Codex `CHANGES_REQUIRED` overrides the primary reviewer's APPROVED.** The
primary does not get a veto over the second pass — if it did, the second pass
would be decorative. This is the one place a later reviewer outranks an earlier
one, and it is deliberate: the second pass exists precisely to catch what the
primary missed.

### Trace findings to requirements

Codex's adversarial prompt does NOT know about SPEC.md REQ-IDs. After
receiving the JSON, the calling skill is responsible for:

1. Reading `.planning/SPEC.md`
2. Tagging each finding with the most likely REQ-ID (or `OUT-OF-SPEC`)
3. Treating `OUT-OF-SPEC` findings as advisory unless the user opts in

## Availability Decision Tree

The primary Claude review has already run and approved at this point — so an
unavailable Codex means "no second opinion," never "no review."

```
Codex script located?
├── No  → record codex_second_pass: unavailable → write status: APPROVED (silently)
└── Yes → Probe `setup --json`
          ├── ready: false → same as above (silently)
          └── ready: true  → ask the user once (opt-in), then run or record `declined`
```

Never prompt the user to install or authenticate Codex. The skill's job is to
use Codex when present, not to onboard it.

## Recording the outcome

**This field is hook-enforced.** `dev-accept` / `ds-verify` declare a PreToolUse
`phase-gate-guard.py` gate with:

```
GATE_REQUIRE_FIELDS="codex_second_pass:completed|declined|unavailable"
```

(The quotes are load-bearing: unquoted, bash reads `|` as a pipe, the env var
never reaches the hook, and the gate silently allows everything.)

so Agent dispatch in the verify phase is blocked until `.planning/REVIEW_STATE.md`
records one of those three values. This puts the second pass on the top tier of
PHILOSOPHY's enforcement gradient (`hook-enforced > artifact check > advisory
text`) — the review skill's prose can be compacted away or rationalized past, but
the hook fires on every tool call.

What the hook can and cannot prove:

- **It can prove a disposition was recorded** rather than silently skipped.
- **It cannot prove Codex ran** — `declined` and `unavailable` are legal, because
  the second pass is opt-in and Codex is optional. That is the intended ceiling:
  the gate enforces *honesty about what happened*, not *that Codex was used*.
- **`error` is excluded from the allowed set**, so an errored second pass
  structurally cannot reach verify. That is the "error is not an approval" rule,
  enforced rather than narrated.

Write **one** value, never the `a | b | c` template line — a literal placeholder
matches no allowed value and the gate blocks it, which is the point: a pasted
template is not a recorded decision.

The consuming skill records what happened in `.planning/REVIEW_STATE.md`:

| `codex_second_pass:` | Meaning | Admits verify? |
|----------------------|---------|----------------|
| `requested` | Launched; no verdict parsed yet | **No** — a launch is not an answer |
| `completed` | Codex ran and returned a verdict | Yes |
| `declined` | Offered; user chose to approve without it | Yes |
| `unavailable` | No script, probe not ready, or no git repo | Yes |
| `error` | Codex ran but failed (non-zero exit / unparseable output) | **No** |

Four rules keep this field honest:

- **A launch is not a verdict.** Record `requested` when you invoke Codex, and
  only `completed` once you have parsed its output. Writing the terminal value
  up front is the bug that makes the whole gate ornamental: combined with a
  `status: APPROVED` left over from an earlier task, it opens verify while Codex
  is still running — or after it crashed. Write a non-approved `status` BEFORE
  invoking, so the window never exists.

- **Never write `enabled` unless a Codex run actually returned a verdict.** The
  field's whole purpose is to distinguish "Codex approved this" from "Codex
  never ran"; a fabricated `enabled` makes the record worse than absent.
- **`error` is not an approval.** An unrun reviewer is not a passing reviewer.
  `error` is an absence of evidence — neither approval nor rejection — so it is
  **not a legal value under `status: APPROVED`**. Only `enabled`, `declined`,
  and `unavailable` are. An `error` sets `status: BLOCKED` and asks the user to
  retry or explicitly decline; only that decision reopens the path forward.
- **`unavailable` and `error` are different facts.** `unavailable` means Codex
  was never reachable (not installed, probe not ready, no git repo) and is
  benign — the primary review stands. `error` means Codex was reached and
  failed, which is a broken reviewer, not an absent one. Collapsing the two
  hides failures behind a silent skip.

## Iteration tracking

The second pass participates in the same `REVIEW_STATE.md` loop as Claude
reviewers — increment iteration on `CHANGES_REQUIRED`, escalate at iteration 3.

**Decide once per loop, not once per iteration.** The opt-in answer is stored in
`codex_second_pass:` and honored on subsequent iterations without re-asking;
only `unavailable` is re-probed (Codex may have been installed since). Asking on
every fix iteration turns an opt-in into nagging.

On each iteration the full order repeats: primary review first, second pass only
if the primary approves.
