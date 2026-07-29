---
name: ds-review
description: "This skill should be used when running Phase 4 of the /ds workflow or reviewing data analysis methodology."
user-invocable: false
disable-model-invocation: true
hooks:
  PostToolUse:
    - matcher: "Agent"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/ds-post-subagent-guard.ts"
  PreToolUse:
    - matcher: "Agent"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/ds-pre-subagent-clear.ts"
    - matcher: "Read"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/ds-read-after-subagent-guard.ts"
    - matcher: "Grep"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/ds-read-after-subagent-guard.ts"
    - matcher: "Glob"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/ds-read-after-subagent-guard.ts"
    - matcher: "Write"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/ds-no-main-chat-code-guard.ts"
    - matcher: "Edit"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/ds-no-main-chat-code-guard.ts"
    - matcher: "Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/ds-no-main-chat-code-guard.ts"
    - matcher: "Agent"
      hooks:
        - type: command
          command: >-
            GATE_ARTIFACT=.planning/VALIDATION.md
            GATE_STATUS=validated
            GATE_DESCRIPTION="Output validation"
            GATE_REMEDY="Run ds-validate first; review is gated until .planning/VALIDATION.md has status: validated. A clean validation is validated. If gaps were found, ds-validate flips status to validated ONLY after the user explicitly accepts them (recorded in an Accepted Gaps section). An undispositioned gaps_found means the user has not yet decided fix-vs-accept — go back to ds-validate's gate."
            GATE_BLOCKED_TOOLS=Agent
            bun ${CLAUDE_PLUGIN_ROOT}/hooks/phase-gate-guard.ts
---

Announce: "Using ds-review (Phase 4) to check methodology and quality."

## Context Monitoring

| Level | Remaining Context | Action |
|-------|------------------|--------|
| Normal | >35% | Proceed normally |
| Warning | 25-35% | Complete current review cycle, then trigger ds-handoff |
| Critical | ≤25% | Immediately trigger ds-handoff — do not start new review cycles |

## Invalidate the previous verdict FIRST

**Before any reviewing starts — the first write of this phase:** if
`.planning/REVIEW_STATE.md` exists and carries `status: APPROVED`, that approval
belongs to the *previous* analysis or iteration. Overwrite it now:

```yaml
---
status: IN_REVIEW
iteration: [N]
max_iterations: 3
last_review_date: [date]
verdict: IN_REVIEW
---
```

Drop any `codex_second_pass:` and `codex_output_file:` from the prior analysis at
the same time — a second pass over last analysis's diff says nothing about this
one.

The loop resets `iteration` for a new analysis but not `status`, so a stale
APPROVED otherwise sits on disk for the whole review — and `status: APPROVED` is
exactly what ds-verify's gate hooks on. Every intermediate state after this point
(`IN_REVIEW`, `SECOND_PASS_PENDING`) keeps that gate shut until this phase
genuinely re-approves. A gate that was already open before the reviewer started
is not a gate.

---

## Review Strategy Choice

After announcing phase, choose the **primary reviewer**.

This choice picks who reviews FIRST. It is not a choice about whether Codex
runs — Codex is a *second pass* over whatever the primary reviewer approves
(see [Codex Second Pass](#codex-second-pass)). The two are additive, never
alternatives.

**Skip this choice when:**
- Exploratory analysis (one-off, not for publication)
- Trivial changes (formatting, documentation)
- Internal reporting (low-stakes, quick turnaround)
- Single notebook with < 100 LOC

**Otherwise, ask the user:**

```python
AskUserQuestion(questions=[{
  "question": "How should we review this analysis?",
  "header": "Review Strategy",
  "options": [
    {"label": "Single reviewer (Default)", "description": "Combined review covering methodology, data quality, and reproducibility. Faster, lower overhead."},
    {"label": "Parallel review (Research-grade)", "description": "Spawn 3 specialized reviewers (Methodology, Reproducibility, Code quality). Use for publications, high-stakes decisions, or research-grade work. Requires reconciliation."}
  ],
  "multiSelect": false
}])
```

**If Single reviewer:** Proceed to [The Iron Law of DS Review](#the-iron-law-of-ds-review) below (current behavior).

**If Parallel review:** Skip to [Parallel Review (Research-Grade)](#parallel-review-research-grade).

Both paths converge on [Phase Complete](#phase-complete), which runs the Codex
second pass before any APPROVED verdict is written.

---

## Codex Second Pass

**When this runs:** after the primary reviewer (single or parallel) returns
APPROVED, and BEFORE `status: APPROVED` is written to `.planning/REVIEW_STATE.md`.
It never runs on CHANGES_REQUIRED, ESCALATE, or BLOCKED — fix those findings
first, and the second pass runs on the next iteration.

**Why it exists:** the primary reviewer is Claude reviewing Claude's analysis.
Codex is a different model family in a different process, so its blind spots are
not correlated with the analyst's. This is the audit-fix-loop Iron Law ("the
auditor must not be the fixer") applied to the model itself.

**What it is good at, and what it is not:** Codex reviews the *code* — leakage
between fit and evaluation, a join that silently fans out rows, a filter applied
after the split, a hardcoded parameter contradicting SPEC.md. It cannot judge
whether the research question is worth asking or whether a result is
substantively interesting. Those stay with the Claude reviewers and the user.
A Codex approval is not evidence the methodology is sound.

> **Reference:** See `references/codex-availability.md` for the full invocation
> contract, JSON schema, and verdict mapping table.

### 1. Decide once per review loop, not once per iteration

Read `.planning/REVIEW_STATE.md`. If it already carries a `codex_second_pass:`
value, honor it and do NOT re-ask:

| Stored value | Meaning | Action |
|--------------|---------|--------|
| `requested` | consented and launched; no verdict yet | **Rejoin it** — go to step 7 and read `codex_output_file`. Relaunch (step 6b) only if that file is missing or unparseable. Do NOT re-ask. |
| `completed` | Codex returned a verdict this iteration | Probe (step 2), then run again for the new fixes — skip step 3 |
| `declined` | user opted out of the loop | Skip the second pass entirely → Phase Complete's APPROVED write |
| `unavailable` / `error` | never reachable / ran and failed | Re-probe (step 2) — Codex may have been installed or fixed since |
| absent | not yet decided | Probe, then ask (steps 2-3) |

Asking on every fix iteration turns an opt-in into nagging. Probe on every
iteration even when consent is stored — it records the user's answer, not
Codex's continued availability.

**`requested` and `completed` are different facts, and conflating them is a
bypass.** `requested` means "we asked Codex"; only `completed` means "Codex
answered". A launched-but-unjoined pass has produced no evidence, so the verify
gate accepts `completed`, `declined`, and `unavailable` — never `requested`.

### 2. Probe Codex availability (silent)

```bash
CODEX_SCRIPT=$(find "$HOME/.claude/plugins/cache/openai-codex/codex" -maxdepth 3 -name codex-companion.mjs -type f 2>/dev/null | sort -rV | head -1)
if [ -n "$CODEX_SCRIPT" ]; then
  node "$CODEX_SCRIPT" setup --json 2>/dev/null | jq -r '.ready // false'
else
  echo "false"
fi
```

If the probe does not print `true`: record `codex_second_pass: unavailable` and
proceed to Phase Complete's APPROVED write. Do **not** announce Codex's absence
and do **not** prompt the user to install it.

### 3. Ask the user (only when the probe printed `true`)

```python
AskUserQuestion(questions=[{
  "question": "Primary review passed. Run a Codex second pass before verify?",
  "header": "Second Pass",
  "options": [
    {"label": "Run Codex second pass (Recommended)", "description": "Independent adversarial review of the analysis code via Codex — a different model family, so its blind spots don't overlap with Claude's. Catches leakage, join fan-out, and spec drift. Findings at >=80 confidence re-enter the fix loop."},
    {"label": "Skip — approve now", "description": "Accept the primary review's APPROVED verdict and proceed to ds-verify. Faster; the analysis is reviewed by Claude only."}
  ],
  "multiSelect": false
}])
```

If the user declines, record `codex_second_pass: declined` and continue to Phase
Complete. If the user opts in, do NOT record `enabled`/`completed` here — nothing
has run yet. Go to step 4; step 5 writes the pending state.

### 4. Prerequisites

Codex adversarial review is **git-diff scoped**. If there is no git repo, record
`codex_second_pass: unavailable` and proceed — do not fabricate a scope.

Notebooks: review the paired text representation (`.py` via jupytext) when one
exists. A diff of `.ipynb` JSON is mostly execution-count and output noise, and
a reviewer reading noise finds nothing.

### 5. Close the gate BEFORE launching

First clear the handle, and **verify the clear worked**. It is
**per-iteration**, and it is emptied *before* the state says `requested`:

```bash
# substitute this iteration's N
OUT=.planning/codex-second-pass-iter[N].json
rm -f "$OUT"
if [ -e "$OUT" ]; then
  echo "BLOCKED: cannot clear $OUT — refusing to request a pass that could join a stale verdict"
  exit 1
fi
```

**A clear that silently failed is worse than no clear.** `rm -f` reports success
for a file that never existed and stays quiet about one it could not remove (a
read-only `.planning/`, wrong ownership, an immutable bit). The launch redirect
would then fail for the same reason, leaving the *old* envelope in place for the
join to read as this pass's answer. Checking that the path is actually gone turns
that assumption into a precondition.

If the clear fails: do NOT record `requested`. Record `codex_second_pass: error`
with `status: BLOCKED` and report it — see
[If the Codex second pass errored](#if-the-codex-second-pass-errored). An
environment that cannot give the pass a clean handle cannot give it an honest
verdict either.

Then write this to `.planning/REVIEW_STATE.md` **before** invoking Codex:

```yaml
---
status: SECOND_PASS_PENDING
iteration: [N]
max_iterations: 3
last_review_date: [date]
issues_found_count: [count from the primary review]
codex_second_pass: requested
codex_output_file: .planning/codex-second-pass-iter[N].json
verdict: SECOND_PASS_PENDING
---
```

**A previous pass's verdict is not this pass's answer.** The shell redirect only
truncates the file when Codex is actually invoked, so a single reused path leaves
a window: stop between this state write and the launch — or resume into the join —
and step 7 would read the *last* iteration's envelope, parse its `approve`, and
write `completed`. The requested pass never ran. A fresh name per iteration plus
the `rm -f` closes both halves; an absent file gives `PENDING` → relaunch.

**Why before, not after.** `status: APPROVED` may still be sitting in this file
from an earlier analysis or iteration — the loop resets `iteration`, not
`status`. If you launch Codex while a stale APPROVED is on disk, the verify gate
is open for the entire time Codex is running: a crash, an interruption, or a
resumed session walks straight into ds-verify on a second pass that never
returned. Writing a non-approved status first means the window never exists.

`codex_output_file` is the join handle (step 7). If the session dies here, the
state on disk still says PENDING and the gate stays shut.

### 6. Estimate scope and choose wait vs background

```bash
git status --short --untracked-files=all
git diff --shortstat --cached
git diff --shortstat
```

Wait when the diff is clearly tiny (1-2 files). Otherwise launch in background.

### 6b. Invoke Codex

Each Bash call runs in a fresh shell, so `$CODEX_SCRIPT` from the probe does not
survive — re-resolve it in the same command that uses it.

**Always pass `--json`, and always redirect to `codex_output_file`.** Both are
load-bearing:

- `--json` is the ONLY form that carries `confidence`. The default rendered text
  prints `[high]` but no number, and the iron law below thresholds on
  confidence >= 0.8 — applied to rendered output it would be a rule with nothing
  to read.
- The redirect turns the verdict into a **file on disk**, which is what makes
  the background path joinable (step 7). Output that exists only in a terminal
  or a transcript is lost to any interruption.

Redirect to the **exact path recorded in `codex_output_file`** — the state file
is the authority on which handle this pass owns:

```bash
CODEX_SCRIPT=$(find "$HOME/.claude/plugins/cache/openai-codex/codex" -maxdepth 3 -name codex-companion.mjs -type f 2>/dev/null | sort -rV | head -1)
node "$CODEX_SCRIPT" adversarial-review --wait --json \
  "focus: data leakage between train/test, join row-count fan-out, filters applied after the split, parameters that contradict .planning/SPEC.md" \
  > .planning/codex-second-pass-iter[N].json 2> .planning/codex-second-pass-iter[N].err
```

**Foreground (small diff):** run the command above and go to step 7.

**Background (anything bigger):** run the **same** command via
`Bash(..., run_in_background: true)`, then tell the user: "Codex second pass
started in the background." Do not advance past step 7's join check until the
background task reports completion — an unjoined launch is not a verdict.

`--background` on the companion is a no-op for reviews: `adversarial-review`
always runs in the foreground (only `task` enqueues a job), so the harness's
`run_in_background` is what actually detaches it. That is exactly why the
redirect matters — the companion is not holding a result for you to fetch later.

### 7. Join the run, then parse the verdict

**The join is a real step, not a hope.** The state on disk says
`codex_second_pass: requested`; nothing may advance until this step turns it
into `completed` or `error`. This is also the resume path: a fresh session that
finds `requested` starts here.

Extract the verdict mechanically — do not read it off the screen:

```bash
uv run python3 - <<'PY'
import json, pathlib, re
state = pathlib.Path('.planning/REVIEW_STATE.md')
m = re.search(r'^codex_output_file:\s*(\S+)\s*$', state.read_text(), re.M) if state.exists() else None
if not m:
    print('ERROR: no codex_output_file recorded — relaunch (step 6b)')
    raise SystemExit(0)
p = pathlib.Path(m.group(1))          # the handle THIS pass owns
if not p.exists() or not p.stat().st_size:
    print('PENDING: no output yet — the run is unfinished, failed, or was lost')
    raise SystemExit(0)
try:
    envelope = json.loads(p.read_text())
    if envelope.get('codex', {}).get('status') != 0:
        print('ERROR: codex exited', envelope.get('codex', {}).get('status'))
        raise SystemExit(0)
    v = json.loads(envelope['codex']['stdout'])   # the schema-validated verdict
except Exception as e:
    print('ERROR: unparseable output —', e)
    raise SystemExit(0)
print('verdict:', v['verdict'])
for f in v.get('findings', []):
    print(f"  {f['confidence']:.2f}  [{f['severity']}]  {f['file']}:{f['line_start']}  {f['title']}")
PY
```

It resolves the path from `codex_output_file` rather than hardcoding one — the
state file names the handle this pass owns, so a verdict left at some other
path by an earlier iteration can never be read as this one's answer.

The payload is an envelope: `{review, target, threadId, codex: {status, stdout}}`,
and `codex.stdout` is the schema-validated verdict **as a JSON string** — it
needs a second parse, which is why this runs as a script and not as an eyeball.

Route on what it printed:

| Printed | Meaning | Do |
|---------|---------|----|
| `verdict: ...` | Codex answered | continue below; the pass is `completed` |
| `PENDING: ...` | still running, or the output was lost | do NOT proceed. If the background task is still going, wait. If it is gone, relaunch (step 6b). The gate stays shut meanwhile. |
| `ERROR: ...` | ran and failed | go to [If the Codex second pass errored](#if-the-codex-second-pass-errored) |

The verdict object: `verdict` (`approve` | `needs-attention`), `summary`,
`findings[]`, `next_steps[]`. Each finding has `severity`, `title`, `body`,
`file`, `line_start`, `line_end`, `confidence` (0-1 float), `recommendation`.

**Apply the iron law: only `confidence >= 0.8` findings block.** Multiply by 100
when displaying alongside Claude-style scores.

| Codex result | Second-pass outcome |
|--------------|---------------------|
| `verdict: approve` | APPROVED — proceed to Phase Complete's APPROVED write |
| `needs-attention` + any finding ≥ 0.8 confidence | CHANGES_REQUIRED — overrides the primary reviewer's APPROVED |
| `needs-attention` + all findings < 0.8 | APPROVED (log advisory findings to LEARNINGS.md) |

**A Codex CHANGES_REQUIRED overrides the primary APPROVED.** The primary
reviewer does not get a veto over the second pass — if it did, the second pass
would be decorative.

**Move `SECOND_PASS_PENDING` to its terminal state in ONE write** — the same
edit sets `status:` and flips `codex_second_pass: requested` -> `completed`. Two
writes means a window where the file claims a verdict it hasn't recorded.

If Codex fails to run (non-zero exit, unparseable output): record
`codex_second_pass: error` and report the failure to the user. Do **not**
silently treat a broken second pass as an approval — an unrun reviewer is not a
passing reviewer.

### 8. Tag findings to requirements

Codex doesn't know SPEC.md REQ-IDs. For each blocking finding: read
`.planning/SPEC.md`, tag it with the most likely REQ-ID (or `OUT-OF-SPEC`).
`OUT-OF-SPEC` findings are advisory unless the user opts in.

### 9. Report

Use the same output structure as the Claude paths, with **Reviewer: Codex
(second pass)** in the header. Each issue includes the Codex confidence (×100)
and the REQ-ID you tagged in step 8.

### 10. Iteration & re-review

The second pass participates in the same `REVIEW_STATE.md` loop — a blocking
second pass increments iteration and returns CHANGES_REQUIRED, escalating at
iteration 3 like any other verdict. On the next iteration the order repeats in
full: primary review first, second pass only if the primary approves.

---

## Parallel Review (Research-Grade)

Use this section when user chose "Parallel review (Research-grade)" above.

> **Prerequisite:** Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` enabled. If unavailable, fall back to single reviewer.

### 1. Prerequisites Check

Before spawning reviewers, verify:

1. **`.planning/SPEC.md` exists** - reviewers verify against spec, not assumptions
2. **`.planning/PLAN.md` exists** - reviewers check tasks were completed
3. **`.planning/LEARNINGS.md` exists** - reviewers verify data quality pipeline documented
4. **Analysis files identified** - notebooks/scripts in scope for review

If any prerequisite fails, STOP and return to /ds-implement.

### 2. When to Use Parallel Review

**Use parallel review when:**
- Publication-bound work (papers, reports, external sharing)
- High-stakes decisions (business strategy, funding, policy)
- Research-grade analysis (academic standards, peer review)
- Regulatory compliance (audit trail required)
- Complex methodology (multiple statistical methods, model comparisons)
- Large codebases (4+ notebooks, multiple scripts)

**Do NOT use when:**
- Exploratory analysis (one-off, not for publication)
- Internal reporting (low-stakes, quick answers)
- Simple descriptive stats (counts, means, basic visualizations)
- Overhead exceeds benefit (single notebook, < 100 LOC)

### 3. Create Team and Spawn Reviewers

#### Team Creation

```
TeamCreate(name="Analysis Review", task_description="Parallel analysis review with 3 specialized reviewers")
```

Press **Shift+Tab** to enter delegate mode. The lead coordinates reviews, does NOT review analysis directly.

#### Spawn 3 Reviewers

Each reviewer receives a self-contained prompt from a reference file. **Reviewers start with a blank conversation and do NOT auto-load skills.** Read the prompt, substitute variables, and paste it in full.

**Tool Restrictions:** All reviewers (Methodology, Reproducibility, Code Quality) are READ-ONLY with `allowed_tools=["Read", "Glob", "Grep", "Bash(read-only)"]`. Reviewers read code and data, run verification checks, and return verdicts. They MUST NOT use Write or Edit.

**Before spawning, substitute these variables in each prompt:**
- `ANALYSIS_FILES` → list of notebooks/scripts in scope (paste actual list)
- `SPEC_CONTEXT` → relevant sections of .planning/SPEC.md (paste inline, do NOT reference file)
- `PLAN_TASKS` → task list from .planning/PLAN.md (paste inline, verify completed)
- `LEARNINGS_PIPELINE` → data quality chain from .planning/LEARNINGS.md (paste inline)
- `PLUGIN_ROOT` → resolved base directory for skill paths (relative to this skill's base directory)

**Reviewer prompts (read, substitute variables, send as message):**

| Reviewer | Focus | Prompt Source |
|----------|-------|---------------|
| 1. Methodology | Statistical soundness, assumptions, bias | `references/methodology-reviewer.md` |
| 2. Reproducibility | Seeds, versions, data traceability | `references/reproducibility-reviewer.md` |
| 3. Code Quality | Data quality handling, bugs, efficiency | `references/code-quality-reviewer.md` |

---

### 4. Lead Monitoring

While reviewers work, the lead:

- **Watches for completion messages** from all 3 reviewers
- **Does NOT review analysis directly** - your job is coordination and reconciliation
- **If a reviewer asks a question:** Answer it, then broadcast to other reviewers if relevant
- **If a reviewer is taking significantly longer than others:** Message them for status
- **When all 3 reviewers complete:** Proceed to reconciliation

### 5. Reconciliation Protocol (3 Passes)

After ALL reviewers message completion, the lead performs three passes.

**This flowchart IS the specification. If the prose below and this diagram disagree, the diagram wins.**

```
   3 reviewer findings sets (Methodology, Reproducibility, Code Quality)
                              │
                              ▼
        ┌─────────────────────────────────────────┐
        │ Pass 1 — DEDUPLICATE                     │
        │ group by file:location + root cause,     │
        │ merge dups (keep highest confidence)     │
        └───────────────────┬─────────────────────┘
                            ▼
        ┌─────────────────────────────────────────┐
        │ Pass 2 — PRIORITIZE                      │
        │ rank critical / important / minor        │
        └───────────────────┬─────────────────────┘
                            ▼
        ┌─────────────────────────────────────────┐
        │ Pass 3 — INTEGRATION CHECK               │
        │ do findings conflict / interact?         │
        └───────────────────┬─────────────────────┘
                  conflict?  │
            ┌──── yes ───────┴────── no ──────┐
            ▼                                  ▼
   ┌──────────────────┐         ┌──────────────────────────┐
   │ escalate to user │         │ any critical/important?   │
   │ with the conflict│         └────────────┬─────────────┘
   └──────────────────┘            ┌── yes ──┴── no ──┐
                                   ▼                  ▼
                          ┌────────────────┐ ┌────────────────┐
                          │ CHANGES REQ'D →│ │ APPROVED       │
                          │ /ds-implement  │ │ (primary only) │
                          │ (max 3 cycles) │ └───────┬────────┘
                          └────────────────┘         │
                                                     ▼
                                          ┌─────────────────────┐
                                          │ Phase Complete      │
                                          │ → Codex second pass │
                                          │ → then ds-verify    │
                                          └─────────────────────┘
```

The primary APPROVED terminates at Phase Complete, not at ds-verify — Phase
Complete is the only section that runs the second pass and writes
`status: APPROVED`.

<EXTREMELY-IMPORTANT>
**Pass 1 — Deduplication:**

Multiple reviewers may find the same issue (e.g., missing seed found by both Reproducibility and Code Quality reviewers).

1. Read all reviewer findings
2. Group by file and location
3. Identify duplicates:
   - Same file:location
   - Same root cause (even if described differently)
4. Merge duplicates:
   - Keep the highest confidence score
   - Combine descriptions if both add value
   - Attribute to both reviewers

**Example:**
```
Reproducibility found: "notebook.ipynb cell 5 - Random seed not set (Confidence: 85)"
Code Quality found: "notebook.ipynb cell 5 - Stochastic operation unseeded (Confidence: 80)"

→ Merge: "notebook.ipynb cell 5 - Random seed missing for train_test_split (Confidence: 85, found by Reproducibility + Code Quality)"
```

**Pass 2 — Prioritization:**

Not all issues are equally important. Rank by:

1. **Severity × Confidence:**
   - Critical (90-100 confidence) > Important (80-89)
   - Methodology > Reproducibility > Code Quality (when confidence is equal)
2. **Impact on conclusions:**
   - Invalidates results > Affects interpretation > Inconvenient
   - Correctness > Reproducibility > Style
3. **Fix effort:**
   - Quick wins (< 30 min) should be fixed now
   - Large refactors (> 2 hours) should be documented as limitations

Create final prioritized list:
```
1. [CRITICAL] Methodology: Selection bias invalidates results (Confidence: 95)
2. [CRITICAL] Code Quality: Join explosion duplicates rows (Confidence: 90)
3. [IMPORTANT] Reproducibility: Random seed missing (Confidence: 85)
4. [IMPORTANT] Code Quality: High-null column in final data (Confidence: 80)
```

**Pass 3 — Integration Check:**

Proposed fixes may conflict with each other or create new problems.

1. Read each reviewer's suggested fixes
2. Check for conflicts:
   - Do two fixes modify the same code?
   - Does one fix introduce a problem another reviewer would flag?
   - Do fixes require contradictory approaches?
3. If conflicts exist:
   - Design a unified fix addressing all concerns
   - OR: Flag the conflict and ask reviewers for input

**Example conflict:**
```
Methodology: "Use stratified sampling to control for confounder"
Code Quality: "Simplify sampling code for readability"

→ Unified: "Use stratified sampling (methodology) with clear variable names and comments (code quality)"
```

**If ANY pass finds conflicts → resolve before reporting final verdict.**
</EXTREMELY-IMPORTANT>

### 6. Final Verdict

After reconciliation, the lead reports:

```markdown
## Parallel Analysis Review: [Analysis Name]

Reviewed by: Methodology, Reproducibility, Code Quality

### Reconciliation Summary

**Issues found:** X total (Y critical, Z important)
**Duplicates merged:** N
**Conflicts resolved:** M

### Critical Issues (Must Fix)

[Deduplicated, prioritized list from Pass 1 + 2]

### Important Issues (Should Fix)

[Deduplicated, prioritized list from Pass 1 + 2]

### Verdict: APPROVED | CHANGES REQUIRED

[If APPROVED]
All 3 reviewers approved with no issues >= 80 confidence. The analysis meets research-grade standards.

[If CHANGES REQUIRED]
X critical and Y important issues must be addressed. Return to /ds-implement.
```

After parallel review completes:

Parallel review produces a *primary* verdict — it is not a terminal state. Do
NOT load ds-verify or write `status: APPROVED` from here.

Go to [Phase Complete](#phase-complete) and follow it for every verdict. Phase
Complete is the single authority that runs the Codex second pass, writes
`.planning/REVIEW_STATE.md`, and invokes ds-verify.

A branch-local "APPROVED → ds-verify" shortcut would let the parallel path reach
verification without the second pass ever running, being declined, or being
recorded — which is exactly the bypass the second pass exists to prevent.

**Maximum 3 review cycles.** If issues persist after 3 rounds of review → implement → re-review, escalate to the user with a summary of unresolved issues. Do not loop indefinitely.

---

# Analysis Review

Single-pass review combining methodology correctness, data quality handling, and reproducibility checks. Uses confidence-based filtering.

<EXTREMELY-IMPORTANT>
## The Iron Law of DS Review

**You MUST only report issues with >= 80% confidence. This is not negotiable.**

Before reporting ANY issue, you MUST:
1. Verify it's not a false positive
2. Verify it impacts results or reproducibility
3. Assign a confidence score
4. Only report if score >= 80

This applies even when:
- "This methodology looks suspicious"
- "I think this might introduce bias"
- "The approach seems unusual"
- "I would have done it differently"

**About to report a low-confidence (<80) issue → DISCARD IT (you'd compromise the review's integrity).**
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## The Iron Law of Re-Review

**NO "FIXED" CLAIMS WITHOUT FRESH RE-REVIEW. This is not negotiable.**

When review returns CHANGES REQUIRED and the analyst applies fixes, you MUST:
1. Re-run the SAME review criteria (methodology, data quality, reproducibility)
2. Verify issues are actually resolved (not assumed)
3. Check for new issues introduced by fixes (data changes, methodology shifts)
4. Only THEN return APPROVED

"I fixed it" without re-reviewing is NOT HELPFUL — unverified fixes ship wrong results to the user.

### The Audit-Fix Loop (Max 3 Iterations)

```
Iteration 1: Review → CHANGES REQUIRED → Fix → Re-Review
              ↓
Iteration 2: Re-Review → CHANGES REQUIRED → Fix → Re-Review
              ↓
Iteration 3: Re-Review → CHANGES REQUIRED → Fix → Re-Review
              ↓
         Still issues? → ESCALATE to user
         All clean? → APPROVED
```

**Track iterations in `.planning/REVIEW_STATE.md`:**

```yaml
---
iteration: 1
max_iterations: 3
last_review_date: 2026-03-09
issues_found_count: 5
---
```

**Exit criteria:**
- **APPROVED**: Zero issues >= 80 confidence
- **ESCALATE**: iteration >= 3 AND issues remain
- **CONTINUE**: iteration < 3 AND issues remain → loop back

**Before returning any verdict, check iteration count:**
1. READ `.planning/REVIEW_STATE.md` (create if missing with iteration: 1)
2. If iteration >= 3 and issues remain: ESCALATE (don't return CHANGES REQUIRED)
3. If iteration < 3 and issues remain: INCREMENT iteration, return CHANGES REQUIRED
4. If no issues: APPROVED

**Claiming APPROVED without re-review after fixes is NOT HELPFUL — the user acts on an approval that has no verification behind it.**

### Re-Review Facts

- An analyst's "I fixed it" is a claim, not a verification — approving on it is rubber-stamping, and the approval carries no evidence.
- Spot-checks of fixed code miss downstream impacts; a "minor" analysis change can break conclusions several steps away. Re-review runs the full criteria, not a diff of the fix.
- A 20-minute re-review is cheap against a retracted result — skipping it to deliver faster is anti-helpful on its own terms.
</EXTREMELY-IMPORTANT>

## Shared Enforcement

**Load shared ds constraints before reviewing.**

Auto-load all constraints matching `applies-to: ds-review`:

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts ds-review`

**You MUST have these constraints loaded before proceeding. No claiming you "remember" them.**

## Review Focus Areas

### Spec Compliance
- [ ] Verify all objectives from .planning/SPEC.md are addressed
- [ ] Confirm success criteria can be verified
- [ ] Check constraints were respected (especially replication requirements)
- [ ] Verify analysis answers the original question

### Master Dataset Consistency
<!-- Per the master-datasets constraint (loaded above). Applies to multi-exhibit projects. -->
- [ ] Every table/figure derives from a declared master dataset — no exhibit re-pulls or re-filters raw sources on its own (per-exhibit pulls produce exhibits that silently disagree)
- [ ] Exhibits that should share a sample DO tie out: shared counts match across tables built from the same master — check BOTH row count AND distinct-key count (e.g. N trades and N distinct CUSIPs); a step dropping rows but no keys means something different from one dropping whole entities (a high-confidence issue if they don't tie)
- [ ] The dataset-construction mermaid diagram matches the code that actually ran — masters, merges, and filters in the diagram exist in the pipeline; the diagram is not stale
- [ ] Each master dataset is unique at its declared grain (run the keyed dedup; a fan-out here corrupts every downstream exhibit)

### Sample Period Coverage (COV)
<!-- Per the sample-coverage constraint C6 (loaded above) and check COV in ds-checks.md. Applies to any analysis with a windowed source. -->
- [ ] SPEC declares ONE canonical sample window plus named sub-windows, each mapped to the task(s) that consume it — the period is NOT scattered across prose with no single authoritative window
- [ ] Every windowed source (raw pull, cache, intermediate, master) has a Required-vs-Actual coverage row; Required is the UNION of the sub-windows of every task that reads it (not just the task it was first pulled for)
- [ ] Run COV yourself: for each windowed source, compute `df[date_col].min()/max()` and confirm it covers that source's Required window — a source pulled for one task's window and reused by a wider-window task silently truncates (uncovered span = zero data, still plausible numbers) (a high-confidence issue if uncovered and undispositioned)
- [ ] Every coverage gap (Actual narrower than Required) is either CLOSED (re-pulled) or has an explicit disposition (task doesn't need the span, or vendor legitimately lacks it) — "the series looked fine" is not a disposition

### Parameter Transparency
<!-- Per the parameter-transparency constraint (loaded above). Applies to any analysis with filters/parameters. -->
- [ ] No magic numbers: filter thresholds, caps, bands, winsorization levels, date windows, and min-obs counts come from a single named config location, not inline literals (grep the pipeline for stray numeric literals in filter/clip/winsorize/date comparisons — any found is a high-confidence issue)
- [ ] The `## Filters & Parameters` table matches the config values actually used (table and code agree; no parameter in code is absent from the table)
- [ ] Every parameter marked principled (✓) is backed by a cited source or a validation result, not "seemed reasonable"
- [ ] Every convenience (⚠) parameter has a disposition that was actually executed — robustness panel run, verified-redundant magnitude shown, or display-only confirmed (a ⚠ parameter with an unexecuted disposition is an unexamined researcher degree of freedom)

### Data Quality Handling
- [ ] Confirm missing values handled appropriately (not ignored)
- [ ] Verify duplicates addressed (documented if kept)
- [ ] Check outliers considered (handled or justified)
- [ ] Verify data types correct (dates parsed, numerics not strings)
- [ ] Confirm filtering logic documented with counts

#### Independent Verification (MANDATORY)

<EXTREMELY-IMPORTANT>
**Do NOT trust the analyst's claims about data quality. Run these checks yourself.**

The analyst may have reported "no duplicates" without actually checking, or "handled missing values" by silently dropping rows. You MUST run independent verification.

**Load shared check definitions first.** Read `${CLAUDE_SKILL_DIR}/../../skills/ds-implement/references/ds-checks.md` and follow its instructions.

Run checks DQ1-DQ5, M1 from the shared definitions. This ensures ds-review and ds-fix use identical checks.
</EXTREMELY-IMPORTANT>

**Post-subagent boundary (C5):** After any review Task agent returns, do NOT read project source code or data files to "double-check." Read the agent's report only. If issues found, re-dispatch.

Dispatch a Task agent to run these checks on the final analysis data:

```python
# 1. Empty/constant columns (useless data kept in analysis)
for col in df.columns:
    if df[col].nunique() <= 1:
        print(f"WARNING: {col} is constant or empty ({df[col].nunique()} unique values)")

# 2. High-null columns still in analysis
null_pct = df.isnull().mean()
high_null = null_pct[null_pct > 0.5]
if len(high_null) > 0:
    print(f"WARNING: Columns >50% null still in data:\n{high_null}")

# 3. Duplicate rows on key columns
key_cols = [...]  # from PLAN.md
dupes = df.duplicated(subset=key_cols, keep=False)
if dupes.sum() > 0:
    print(f"WARNING: {dupes.sum()} duplicate rows on {key_cols}")
    print(df[dupes].head())

# 4. Row count traceability
# Compare: raw input rows → after cleaning → after joins → final
# Each step should be documented in LEARNINGS.md
print(f"Final row count: {len(df)}")
# Verify this matches the chain documented in LEARNINGS.md

# 5. Cardinality check on categorical columns
for col in df.select_dtypes(include='object').columns:
    n_unique = df[col].nunique()
    if n_unique > 0.9 * len(df):
        print(f"WARNING: {col} has near-unique cardinality ({n_unique}/{len(df)}) — likely an ID, not a category")
    if n_unique == len(df):
        print(f"INFO: {col} is fully unique — confirm this is a key, not a category used in groupby")
```

**If ANY check produces a WARNING, this is a high-confidence issue (>=80). Report it.**

### Methodology Appropriateness
- [ ] Verify statistical methods appropriate for data type
- [ ] Check assumptions documented and verified (normality, independence, etc.)
- [ ] Confirm sample sizes adequate for conclusions
- [ ] Check multiple comparisons addressed if applicable
- [ ] Verify causality claims justified (or appropriately limited)

### Reproducibility
- [ ] Verify random seeds set where needed
- [ ] Check package versions documented
- [ ] Verify data source/version documented
- [ ] Confirm all transformations traceable
- [ ] Verify results can be regenerated

### Output Quality
- [ ] Verify visualizations labeled (title, axes, legend)
- [ ] Check numbers formatted appropriately (sig figs, units)
- [ ] Verify conclusions supported by evidence shown
- [ ] Confirm limitations acknowledged

## Confidence Scoring

Rate each potential issue from 0-100:

| Score | Meaning |
|-------|---------|
| 0 | False positive or style preference |
| 25 | Might be real, methodology is unusual but valid |
| 50 | Real issue but minor impact on conclusions |
| 75 | Verified issue, impacts result interpretation |
| 100 | Certain error that invalidates conclusions |

**CRITICAL: You MUST only report issues with confidence >= 80. If you report below this threshold, you're misrepresenting your certainty.**

## Common DS Issues to Check

### Data Leakage
- Training data contains information from future
- Test data used in feature engineering
- Target variable used directly or indirectly in features

### Selection Bias
- Filtering introduced systematic bias
- Survivorship bias in longitudinal data (analyzing only surviving entities — e.g., only companies that didn't delist)
- Non-random sampling not addressed

### Join Explosion
- Many-to-many joins silently multiplying rows
- Detection: compare `COUNT(*)` before and after join — any increase signals duplication
```sql
SELECT 'before' AS stage, COUNT(*) FROM a
UNION ALL
SELECT 'after', COUNT(*) FROM a JOIN b ON a.key = b.key;
```
- Always check join key uniqueness: `SELECT key, COUNT(*) FROM b GROUP BY key HAVING COUNT(*) > 1`

### Incomplete Period Comparison
- Comparing a partial current period (e.g., this month so far) to a full prior period
- Metrics will always look lower for the incomplete period — normalize by days elapsed or filter to complete periods only

### Denominator Shifting
- Rate or ratio denominators change between periods, making rates incomparable
- Example: "conversion rate dropped" but actually the denominator (total visitors) grew while numerator stayed flat
- Always report both numerator and denominator, not just the ratio

### Average of Averages
- Averaging pre-computed group averages produces incorrect results when group sizes differ
- Must compute weighted average or aggregate from raw data
- Example: avg(store_avg_price) ≠ avg(price) across all items

### Timezone Mismatches
- Different data sources using different timezones (UTC vs local vs server time)
- Symptoms: off-by-one day counts, missing hours around DST transitions, events appearing at impossible times
- Always document timezone assumptions per source and convert to a single timezone early in the pipeline

### Simpson's Paradox
- Aggregate trend reverses when data is segmented by a confounding variable
- Example: treatment appears better overall but worse in every subgroup because of unequal group sizes
- When reporting aggregate results, always check if the trend holds within key segments

### Statistical Errors
- Multiple testing without correction
- p-hacking or selective reporting
- Correlation interpreted as causation
- Inadequate sample size for claimed precision

### Reproducibility Failures
- Random operations without seeds
- Undocumented data preprocessing
- Hard-coded paths or environment dependencies
- Missing package versions

## Required Output Structure

```markdown
## Analysis Review: [Analysis Name]
Reviewing: [files/notebooks being reviewed]

### Critical Issues (Confidence >= 90)

#### [Issue Title] (Confidence: XX)

**Location:** `file/path.py:line` or `notebook.ipynb cell N`

**Problem:** Clear description of the issue

**Impact:** How this affects results/conclusions

**Requirement:** [REQ-ID from SPEC.md if this issue relates to a specific requirement, or "general"]

**Fix:**
```python
# Specific fix
```

### Important Issues (Confidence 80-89)

[Same format as Critical Issues]

### Data Quality Checklist

| Check | Status | Notes |
|-------|--------|-------|
| Missing values | PASS/FAIL | [details] |
| Duplicates | PASS/FAIL | [details] |
| Outliers | PASS/FAIL | [details] |
| Type correctness | PASS/FAIL | [details] |

### Methodology Checklist

| Check | Status | Notes |
|-------|--------|-------|
| Appropriate for data | PASS/FAIL | [details] |
| Assumptions checked | PASS/FAIL | [details] |
| Sample size adequate | PASS/FAIL | [details] |

### Reproducibility Checklist

| Check | Status | Notes |
|-------|--------|-------|
| Seeds set | PASS/FAIL | [details] |
| Versions documented | PASS/FAIL | [details] |
| Data versioned | PASS/FAIL | [details] |

### Summary

**Verdict:** APPROVED | CHANGES REQUIRED

[If APPROVED]
The analysis meets quality standards. No methodology issues with confidence >= 80 detected.

[If CHANGES REQUIRED]
X critical issues and Y important issues must be addressed before proceeding.
```

## Agent Invocation

Spawn a Task agent to review the analysis:

```
Task(subagent_type="general-purpose",
  allowed_tools=["Read", "Glob", "Grep", "Bash(read-only)"],
  prompt="""
Review analysis against .planning/SPEC.md.

Execute TWO-PASS review:

PASS 1 - Independent Data Quality Verification (RUN CODE):
1. Load the final analysis data
2. Check for empty/constant columns (nunique <= 1)
3. Check for high-null columns (>50% null)
4. Check for duplicate rows on key columns
5. Verify row count matches LEARNINGS.md chain
6. Check cardinality of categorical columns
Report any WARNING as confidence >= 80.

PASS 2 - Methodology and Compliance Review (READ CODE):
1. Spec compliance - verify all SPEC.md objectives addressed
2. Master dataset consistency - confirm every exhibit derives from a declared master (none re-pulls raw sources); exhibits sharing a master tie out (matching N/counts); the dataset-construction mermaid diagram matches the code that ran. Mismatched counts across exhibits that should share a sample = confidence >= 80.
3. Parameter transparency - grep for inline numeric literals in filter/clip/winsorize/date-comparison code; confirm all come from the named config location and match the Filters & Parameters table; confirm principled(✓) params cite a source/validation and every convenience(⚠) param has an EXECUTED disposition (robustness panel / verified-redundant / display-only). Stray magic numbers, or ⚠ params with unexecuted dispositions, = confidence >= 80.
4. Data quality handling - confirm issues from PLAN.md were resolved
5. Methodology - verify appropriate methods, assumptions checked
6. Reproducibility - confirm seeds, versions, documentation

Confidence score each issue (0-100).
Report only issues with >= 80 confidence.
Return structured output per /ds-review format.
""")
```

### Review Facts

- Reading the analyst's notebook or LEARNINGS.md and thinking "looks reasonable" is not verification — only executed code that independently checks the results is. An approval without it is a rubber stamp the user mistakes for review.
- Output-first verification during implementation catches per-step issues, not cumulative ones — the final state must be checked independently, or the review verifies nothing the implementer didn't already.
- The verification checks take seconds; a skipped 30-second check has let a join explosion through that took 3 days to debug. Reading instead of running is anti-efficient.
- Issues reported below 80 confidence are noise that drowns the real findings — flagging them to appear thorough makes the review less useful, not more.
- "Minor data issues won't affect conclusions" is a magnitude claim made without measuring the magnitude — quantify the impact, then decide.

## Delete & Restart: Fundamental Methodology Failures

<EXTREMELY-IMPORTANT>
**If methodology is fundamentally flawed, DELETE the implementation and return to ds-plan. No patching.**

A methodology is fundamentally flawed when:
- **Wrong statistical approach** (e.g., linear regression on non-linear data, parametric test on non-normal data without justification)
- **Wrong data source** (e.g., using quarterly data when daily is required, wrong table entirely)
- **Missing critical variable** (e.g., no control for a known confounder, omitted variable bias)
- **Wrong unit of analysis** (e.g., analyzing at firm-level when the question is about transactions)

**Methodology-flaw facts:** tweaking parameters around a wrong statistical method is p-hacking, not fixing; a known confounder omitted from the main analysis invalidates it — adding it as a "robustness check" leaves the headline result wrong; and patching a flawed foundation produces a patched flawed analysis. All three cases mean DELETE and replan, not iterate.

**When you identify a fundamental flaw:**
1. Document the flaw in LEARNINGS.md (what's wrong and why it can't be patched)
2. Report to user: "Methodology is fundamentally flawed: [specific reason]. Returning to ds-plan."
3. Return to ds-plan (not ds-implement) — the plan itself needs rethinking

**Patching a broken methodology to avoid rework is NOT HELPFUL — the user deserves correct analysis, not fast wrong analysis.**
</EXTREMELY-IMPORTANT>

## Visual Diagnostics for Review Decision Points

When presenting review findings to the user (especially at CHANGES REQUIRED verdicts), generate diagnostic plots to support the decision:

| Review Finding | Diagnostic to Generate |
|---------------|----------------------|
| Join explosion detected | Row count waterfall (before/after each join) |
| Selection bias suspected | Distribution comparison (included vs excluded populations) |
| Missing value impact | Missingness heatmap (columns x time periods) |
| Outlier influence | Coefficient sensitivity plot (with/without outliers) |
| Reproducibility failure | Side-by-side run comparison (key metrics from Run 1 vs Run 2) |

**Format:** Inline plots in notebooks, or saved to `scratch/diagnostics/` for script-based workflows. Present alongside the review verdict.

**When to generate:** Only at `decision` checkpoints where the user must choose between accepting or fixing. Do not generate plots for clean review passes (no decision needed).

**Observe → record → offer (learn-by-doing):** After each review decision checkpoint, append one line to `.planning/LEARNINGS.md` recording **which diagnostic the user actually looked at** to make the call (e.g. `review-view: row-count waterfall (join explosion)` or `review-view: read verdict summary only — no plot`). Do NOT build visualizations speculatively. After the **same** view is requested 3+ times across reviews, offer to bundle a script in `skills/ds-review/scripts/` that generates it automatically. Until then, the table above is an offer menu, not a mandate.

## Quality Standards

- **You must NOT report methodology preferences not backed by statistical principles.** Your opinion about how code should be written is not a review issue.
- **You must treat alternative valid approaches as non-issues (confidence = 0).** If the approach works correctly, don't report it.
- Ensure each reported issue is immediately actionable
- **If you're unsure, rate it below 80 confidence.** Uncertainty is not a reason to report—it's a reason to investigate more.
- Focus on what affects conclusions, not style. **About to report a style/preference/coding-convention issue → DISCARD it (out of scope — this review judges conclusions, not style).**

## Gate: Exit Review Loop

**Checkpoint type:** human-verify (review scores are machine-verifiable)

Before claiming review is complete (APPROVED or ESCALATE):

```
1. IDENTIFY → What proves the review verdict is valid?
             - APPROVED: Zero issues >= 80 confidence
             - ESCALATE: iteration >= 3 AND issues remain

2. RUN     → Check `.planning/REVIEW_STATE.md` for iteration count
             Read review output for issue count

3. READ    → Examine both:
             - Review output (issues list)
             - REVIEW_STATE.md (iteration number)

4. VERIFY  → Verdict matches state:
             - APPROVED only if 0 issues
             - ESCALATE only if iteration >= 3
             - CHANGES REQUIRED only if iteration < 3

5. CLAIM   → Only after steps 1-4 pass, return verdict
```

**If iteration >= 3 and you're returning CHANGES REQUIRED instead of ESCALATE, you're being anti-helpful — the user needs to know when the loop isn't converging.**

## Phase Complete

After review completes, handle verdict-specific transitions:

### If APPROVED (no issues >= 80 confidence)

**STOP — run the [Codex Second Pass](#codex-second-pass) first.** A primary
APPROVED is a candidate verdict, not a final one. Writing `status: APPROVED`
before the second pass runs would hand ds-verify a gate that no second reviewer
ever saw.

Order of operations:

1. Run the Codex second pass (it self-skips when Codex is unavailable or declined).
2. If it returns **CHANGES_REQUIRED**, follow [If CHANGES REQUIRED](#if-changes-required-issues--80-confidence-found-iteration--3) instead of this section.
3. Only if it returns **APPROVED** (or self-skipped), write the state below.

Mark review complete in `.planning/REVIEW_STATE.md`:

```yaml
---
status: APPROVED
iteration: [N]
max_iterations: 3
last_review_date: [date]
issues_found_count: 0
codex_second_pass: completed | declined | unavailable
verdict: APPROVED
---
```

`codex_second_pass` records what actually happened, so a later reader can tell
"Codex approved this" from "Codex never ran." Never write `completed` unless a
Codex run actually returned a verdict you parsed in step 7.

**`requested` and `error` are not valid under `status: APPROVED`** — those three
are the only ones. `requested` is a launch, not an answer; `error` is a failure,
not an answer. Neither supports an approval; see
[If the Codex second pass errored](#if-the-codex-second-pass-errored).

**This is hook-enforced, not advisory.** ds-verify gates Agent dispatch on
`GATE_REQUIRE_FIELDS=codex_second_pass:completed|declined|unavailable`, so verify
cannot start until this field records one of those three. Substitute a single
value — pasting the `completed | declined | unavailable` line verbatim matches
nothing and the gate blocks it.

**`status: APPROVED` is the structural gate field** — ds-verify declares a PreToolUse `phase-gate-guard.py` hook that blocks Agent dispatch until `.planning/REVIEW_STATE.md` shows `status: APPROVED`. While the review loop is unresolved (CHANGES_REQUIRED / ESCALATE), `status` is NOT `APPROVED`, so verification is structurally blocked.

Immediately discover and load ds-verify:
Read `${CLAUDE_SKILL_DIR}/../../skills/ds-verify/SKILL.md` and follow its instructions.

### If the Codex second pass errored

Codex ran but produced no verdict (non-zero exit, unparseable output). **This is
not an approval and not a rejection — it is an absence of evidence.** Do NOT
write `status: APPROVED` and do NOT load ds-verify.

Record the attempt and leave the gate closed:

```yaml
---
status: BLOCKED
iteration: [N]          # unchanged — no review verdict was produced
max_iterations: 3
last_review_date: [date]
issues_found_count: [count from the primary review]
codex_second_pass: error
verdict: BLOCKED
---
```

Report the failure to the user and ask how to proceed:

```python
AskUserQuestion(questions=[{
  "question": "The Codex second pass failed to produce a verdict. How should we proceed?",
  "header": "Second Pass",
  "options": [
    {"label": "Retry the second pass", "description": "Re-run Codex. Transient failures (auth expiry, a dropped thread) usually clear on a retry."},
    {"label": "Approve without it", "description": "Record codex_second_pass: declined and proceed to ds-verify on the primary review alone. The analysis is reviewed by Claude only."}
  ],
  "multiSelect": false
}])
```

- **Retry** → return to [Codex Second Pass](#codex-second-pass) step 2.
- **Approve without it** → rewrite `codex_second_pass: declined` and follow
  [If APPROVED](#if-approved-no-issues--80-confidence) from the top.

Only an explicit user decision converts an `error` into a path forward. Silently
downgrading it to an approval is the fabricated-verdict failure this skill exists
to prevent.

### If CHANGES REQUIRED (issues >= 80 confidence found, iteration < 3)

Update `.planning/REVIEW_STATE.md`:

```yaml
---
status: CHANGES_REQUIRED
iteration: [N+1]
max_iterations: 3
last_review_date: [date]
issues_found_count: [count]
codex_second_pass: completed | declined | unavailable
verdict: CHANGES_REQUIRED
---
```

Carry `codex_second_pass` forward unchanged — the decision is made once per
review loop, not re-asked on each iteration.

Return to `/ds-implement` with specific issues. **Analyst MUST re-invoke /ds-review after fixes.**

When the blocking findings came from the second pass, say so in the handoff
("Codex second pass, REQ-DATA-03, confidence 91") — the analyst needs to know
which reviewer to satisfy.

**Critical:** When analyst returns claiming "fixed", you MUST re-run the FULL review. No shortcuts.

### If ESCALATE (iteration >= 3, issues remain)

Update `.planning/REVIEW_STATE.md`:

```yaml
---
status: ESCALATE
iteration: 3
max_iterations: 3
last_review_date: [date]
issues_found_count: [count]
verdict: ESCALATE
---
```

Report to user:

```
Review Loop Escalation (3 iterations completed)

After 3 fix-review cycles, [N] issues remain:

[List issues]

Options:
1. Accept current state and document limitations
2. Extend review (manual approval for iteration 4+)
3. Rethink methodology (return to /ds-plan)

Which option do you prefer?
```

## Workflow Continuity After Review

| Verdict | Next Action | Iteration Counter |
|---------|-------------|-------------------|
| APPROVED (primary) | Run the [Codex Second Pass](#codex-second-pass) before writing `status: APPROVED` | No change (not a terminal verdict) |
| APPROVED (second pass done/skipped) | Invoke /ds-verify immediately | Reset to 1 for next analysis |
| CHANGES REQUIRED | Return to /ds-implement, analyst fixes then re-invokes /ds-review | Increment |
| ESCALATE | Ask user for direction | Keep at max |

**Do NOT pause between review completion and next action.** The workflow is sequential.
