---
name: dev-review
description: "This skill should be used when the user asks to 'review the code', 'check implementation quality', or 'run code review'."
user-invocable: false
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/dev-delegation-guard.py"
    - matcher: "Agent"
      hooks:
        - type: command
          command: >-
            GATE_ARTIFACT=.planning/VALIDATION.md
            GATE_STATUS=validated
            GATE_BLOCKED_TOOLS=Agent
            GATE_DESCRIPTION="Test gap validation"
            GATE_REMEDY="Return to dev-implement and run dev-test-gaps (Phase 5.5). VALIDATION.md must have status: validated (not gaps_found) before review starts."
            uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/phase-gate-guard.py
---

**Iteration topology:** parallel multi-reviewer fan-out (fresh read-only subagents; main chat reconciles)

### Context Check

Before starting this phase, check remaining context:

| Level | Remaining | Action |
|-------|-----------|--------|
| Normal | >35% | Proceed |
| Warning | 25-35% | Finish the current step, then invoke dev-handoff |
| Critical | ≤25% | Invoke dev-handoff immediately — resume fresh |

At Warning/Critical: Read `${CLAUDE_SKILL_DIR}/../../skills/dev-handoff/SKILL.md` and follow its instructions.

### The Iron Law of Topic Changes

**If the user sends a message NOT about the current review, announce the loop pause before responding — then resume.** dev-review runs a REVIEW_STATE.md fix-and-re-review loop; silently abandoning it (as dev-debug:121-139 documents) drops the structure the user invoked.

**Protocol:**
1. Announce: "Pausing the dev-review loop to address your request."
2. Handle the off-topic request (normal tools allowed — you're outside the loop).
3. Announce: "Resuming dev-review. Re-reading .planning/REVIEW_STATE.md for current state."
4. Re-read `.planning/REVIEW_STATE.md` and continue the review/fix iteration.

If the message could be EITHER a new topic OR part of the review, ask before assuming — do NOT silently abandon the loop.

## Contents

- [Prerequisites - Test Output Gate](#prerequisites---test-output-gate)
- [Invalidate the previous verdict FIRST](#invalidate-the-previous-verdict-first) (first write of the phase)
- [Review Strategy Choice](#review-strategy-choice) (picks the primary reviewer)
- [Codex Second Pass](#codex-second-pass) (optional second opinion before any APPROVED verdict)
- [Parallel Review (Thorough)](#parallel-review-thorough)
- [The Iron Law of Review](#the-iron-law-of-review) (single Claude reviewer path)
- [Review Focus Areas](#review-focus-areas)
- [Confidence Scoring](#confidence-scoring)
- [Required Output Structure](#required-output-structure)
- [Agent Invocation](#agent-invocation)
- [Quality Standards](#quality-standards)

# Code Review

**Load shared enforcement:**

Auto-load all constraints matching `applies-to: dev-review`:

!`uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py dev-review`

**You MUST have these constraints loaded before proceeding. No claiming you "remember" them.**

**Dynamic plan re-read:** Before starting review, re-read `.planning/SPEC.md` and `.planning/PLAN.md` to catch any requirements or tasks added during implementation. Do not rely on cached state from prior phases.

Single-pass code review combining spec compliance and quality checks. Uses confidence-based filtering to report only high-priority issues.

<EXTREMELY-IMPORTANT>
## Prerequisites - Test Output Gate

**Do NOT start review without test evidence.**

Before reviewing, verify these preconditions:
1. `.planning/LEARNINGS.md` contains **actual test output**
2. Tests were **run** (not just written)
3. Test output shows **PASS** (not SKIP, not assumed)

### What Counts as Test Evidence

| Valid Evidence | NOT Valid |
|----------------|-----------|
| `meson test` output with results | "Tests should pass" |
| `pytest` output showing PASS | "I wrote tests" |
| Screenshot of working UI | "It looks correct" |
| Playwright snapshot showing expected state | "User can verify" |
| D-Bus command output | "The feature works" |
| **E2E test output with user flow verified** | **"Unit tests pass" (for UI changes)** |

<EXTREMELY-IMPORTANT>
### The E2E Evidence Requirement

**FOR USER-FACING CHANGES: Unit test evidence is INSUFFICIENT.**

Before approving user-facing changes, verify:
1. Unit tests pass (necessary but not sufficient)
2. **E2E tests pass** (required for approval)
3. Visual evidence exists (screenshots/snapshots for UI)

| Change Type | Unit Evidence | E2E Evidence | Approval? |
|-------------|---------------|--------------|------------|
| Internal refactor | Yes | N/A | APPROVE |
| API change | Yes | Missing | BLOCKED |
| UI change | Yes | Missing | BLOCKED |
| User workflow | Yes | Missing | BLOCKED |

Return BLOCKED if E2E evidence is missing for user-facing changes.

"Unit tests pass" without E2E for UI changes is NOT approvable.
</EXTREMELY-IMPORTANT>

### Gate Check

Check LEARNINGS.md for test output:

```bash
rg -E "(PASS|OK|SUCCESS|\d+ passed)" .planning/LEARNINGS.md
```

If no test output is found, STOP and return to /dev-implement.

"It should work" is NOT evidence. Test output IS evidence.
</EXTREMELY-IMPORTANT>

## Invalidate the previous verdict FIRST

**Before any reviewing starts — the first write of this phase:** if
`.planning/REVIEW_STATE.md` exists and carries `status: APPROVED`, that approval
belongs to the *previous* task or iteration. Overwrite it now:

```yaml
---
status: IN_REVIEW
iteration: [N]
max_iterations: 3
last_review_date: [date]
verdict: IN_REVIEW
---
```

Drop any `codex_second_pass:` and `codex_output_file:` from the prior task at the
same time — a second pass over last task's diff says nothing about this one.

The loop resets `iteration` for a new task but not `status`, so a stale APPROVED
otherwise sits on disk for the whole review — and `status: APPROVED` is exactly
what dev-verify's gate hooks on. Every intermediate state after this point
(`IN_REVIEW`, `SECOND_PASS_PENDING`) keeps that gate shut until this phase
genuinely re-approves. A gate that was already open before the reviewer started
is not a gate.

---

## Review Strategy Choice

After verifying test output in LEARNINGS.md, choose the **primary reviewer**.

This choice picks who reviews FIRST. It is not a choice about whether Codex
runs — Codex is a *second pass* over whatever the primary reviewer approves
(see [Codex Second Pass](#codex-second-pass)). The two are additive, never
alternatives: a Codex pass that replaced Claude would leave the diff reviewed
exactly once, which is the single-reviewer blind spot the second pass exists
to close.

**Skip this choice when:**
- Trivial changes (< 50 LOC, single file)
- Purely cosmetic changes (formatting, comments)
- Automated refactoring (rename, extract)
- Internal utility functions (not user-facing or security-sensitive)

**Ask the user:**

```python
AskUserQuestion(questions=[{
  "question": "How should we review this implementation?",
  "header": "Review Strategy",
  "options": [
    {"label": "Single reviewer (Default)", "description": "Combined review covering spec compliance and code quality. Faster, lower overhead."},
    {"label": "Parallel review (Thorough)", "description": "Spawn 3 specialized reviewers (Security, Performance, Tests). Use for security-sensitive, performance-critical, or test-heavy PRs. Requires reconciliation."}
  ],
  "multiSelect": false
}])
```

**Routing:**

| Choice | Go to |
|--------|-------|
| Single (Claude) reviewer | [The Iron Law of Review](#the-iron-law-of-review) |
| Parallel (Claude) review | [Parallel Review (Thorough)](#parallel-review-thorough) |

Both paths converge on [Phase Complete](#phase-complete), which runs the Codex
second pass before any APPROVED verdict is written.

---

## Codex Second Pass

**When this runs:** after the primary reviewer (single or parallel) returns
APPROVED, and BEFORE `status: APPROVED` is written to `.planning/REVIEW_STATE.md`.
It never runs on CHANGES_REQUIRED, ESCALATE, or BLOCKED — there is nothing to
second-guess when the primary reviewer already found blocking issues; fix those
first and the second pass runs on the next iteration.

**Why it exists:** the primary reviewer is Claude reviewing Claude's code. Codex
is a different model family in a different process, so its blind spots are not
correlated with the implementer's. This is the audit-fix-loop Iron Law ("the
auditor must not be the fixer") applied to the model itself.

> **Reference:** See `references/codex-availability.md` for the full invocation
> contract, JSON schema, and verdict mapping table.

### 1. Decide once per review loop, not once per iteration

Read `.planning/REVIEW_STATE.md`. If it already carries a `codex_second_pass:`
value, honor it and do NOT re-ask:

| Stored value | Meaning | Action |
|--------------|---------|--------|
| `requested` | consented and launched; no verdict yet | **Rejoin it** — go to step 7 and read `codex_output_file`. Relaunch (step 6) only if that file is missing or unparseable. Do NOT re-ask. |
| `completed` | Codex returned a verdict this iteration | Probe (step 2), then run again for the new fixes — skip step 3 |
| `declined` | user opted out of the loop | Skip the second pass entirely → Phase Complete's APPROVED write |
| `unavailable` / `error` | never reachable / ran and failed | Re-probe (step 2) — Codex may have been installed or fixed since |
| absent | not yet decided | Probe, then ask (steps 2-3) |

Asking on every fix iteration turns an opt-in into nagging, and a user who
answers "no" three times has been asked three times too many.

Probe on every iteration even when consent is stored — it records the user's
answer, not Codex's continued availability.

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
and do **not** prompt the user to install it — this skill's job is to use Codex
when present, not to onboard it.

### 3. Ask the user (only when the probe printed `true`)

```python
AskUserQuestion(questions=[{
  "question": "Primary review passed. Run a Codex second pass before verify?",
  "header": "Second Pass",
  "options": [
    {"label": "Run Codex second pass (Recommended)", "description": "Independent adversarial review via Codex — a different model family in a separate process, so its blind spots don't overlap with Claude's. Findings at >=80 confidence re-enter the fix loop."},
    {"label": "Skip — approve now", "description": "Accept the primary review's APPROVED verdict and proceed to dev-verify. Faster; the diff is reviewed by Claude only."}
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
write `completed`. The requested pass never ran. Both halves close that: a fresh
name per iteration means last iteration's answer is never at this iteration's
path, and the `rm -f` means a re-launch within an iteration cannot join its own
stale output either. Absent file → `PENDING` → relaunch, which is correct.

**Why before, not after.** `status: APPROVED` may still be sitting in this file
from an earlier task or iteration — the loop resets `iteration`, not `status`.
If you launch Codex while a stale APPROVED is on disk, the verify gate is open
for the entire time Codex is running: a crash, an interruption, or a resumed
session walks straight into dev-verify on a second pass that never returned.
Writing a non-approved status first means the window never exists — the gate is
shut before the reviewer is even asked, and only its verdict reopens it.

`codex_output_file` is the join handle (step 7). It is a path, not a promise:
if the session dies here, the state on disk still says PENDING and the gate
stays shut.

### 6. Estimate scope and choose wait vs background

```bash
git status --short --untracked-files=all
git diff --shortstat --cached
git diff --shortstat
```

Wait when the diff is clearly tiny (1-2 files, no untracked dir-sized changes).
Otherwise launch in background.

### 6b. Invoke Codex

Each Bash call runs in a fresh shell, so `$CODEX_SCRIPT` from the probe does not
survive — re-resolve it in the same command that uses it.

**Always pass `--json`, and always redirect to `codex_output_file`.** Both are
load-bearing:

- `--json` is the ONLY form that carries `confidence`. The default rendered text
  prints `[high]` but no number, and the iron law below thresholds on
  confidence ≥ 0.8 — applied to rendered output it would be a rule with nothing
  to read.
- The redirect turns the verdict into a **file on disk**, which is what makes
  the background path joinable (step 7). Output that exists only in a terminal
  or a transcript is lost to any interruption.

Redirect to the **exact path recorded in `codex_output_file`** — the state file
is the authority on which handle this pass owns:

```bash
CODEX_SCRIPT=$(find "$HOME/.claude/plugins/cache/openai-codex/codex" -maxdepth 3 -name codex-companion.mjs -type f 2>/dev/null | sort -rV | head -1)
node "$CODEX_SCRIPT" adversarial-review --wait --json \
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

**Optional focus text** — append SPEC.md context to weight the review:

```bash
node "$CODEX_SCRIPT" adversarial-review --wait --json \
  "focus: REQ-AUTH-01 token rotation under retry" \
  > .planning/codex-second-pass-iter[N].json 2> .planning/codex-second-pass-iter[N].err
```

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
edit sets `status:` and flips `codex_second_pass: requested` → `completed`. Two
writes means a window where the file claims a verdict it hasn't recorded, or
records a disposition with a status that no longer matches it.

If Codex fails to run (non-zero exit, unparseable output): record
`codex_second_pass: error` and report the failure to the user. Do **not**
silently treat a broken second pass as an approval — an unrun reviewer is not a
passing reviewer.

### 8. Tag findings to requirements

Codex doesn't know SPEC.md REQ-IDs. For each blocking finding:

1. Read `.planning/SPEC.md`
2. Tag the finding with the most likely REQ-ID (or `OUT-OF-SPEC`)
3. `OUT-OF-SPEC` findings are advisory unless the user opts in

### 9. Report

Use the same output structure as `## Required Output Structure` below, with
**Reviewer: Codex (second pass)** in the header. Each issue includes the Codex
confidence (×100) and the REQ-ID you tagged in step 8.

### 10. Iteration & re-review

The second pass participates in the same `REVIEW_STATE.md` loop as Claude
reviewers — a blocking second pass increments iteration and returns
CHANGES_REQUIRED, escalating at iteration 3 like any other verdict.

On the next iteration the order repeats in full: primary review runs first, and
the second pass runs again only if the primary approves. The "Iron Law of
Re-Review" applies to Codex too — the implementer claims "fixed", main chat
re-invokes the full review, no spot-checks.

---

## Parallel Review (Thorough)

Use this section when user chose "Parallel review (Thorough)" above.

> **Prerequisite:** Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` enabled. If unavailable, fall back to single reviewer.

### 1. Prerequisites Check

Before spawning reviewers, verify:

1. **Test evidence exists** - LEARNINGS.md contains actual test output (check first!)
2. **E2E evidence for UI changes** - User-facing changes have E2E test output (not just unit tests)
3. **Changed files identified** - `git diff --name-only` to scope review
4. **SPEC.md exists** - reviewers verify against spec, not assumptions

If any prerequisite fails, STOP and return BLOCKED to /dev-implement.

### 2. When to Use Parallel Review

**Use parallel review when:**
- Security-sensitive changes (auth, permissions, data access, crypto, input validation)
- Performance-critical paths (tight loops, database queries, API endpoints)
- Test-heavy PRs (new test infrastructure, testing frameworks, E2E flows)
- Complex PRs (4+ files changed, multiple subsystems affected)
- High-stakes deployments (production hotfixes, customer-facing releases)

**Do NOT use when:**
- Simple bug fixes (< 50 LOC, single file)
- Documentation or config changes
- Automated refactoring (no logic changes)
- Internal utilities (not security-sensitive or performance-critical)
- Overhead exceeds benefit (< 4 files changed)

### 3. Create Team and Spawn Reviewers

#### Team Creation

```
TeamCreate(name="Code Review", task_description="Parallel code review with 3 specialized reviewers")
```

Press **Shift+Tab** to enter delegate mode. The lead coordinates reviews, does NOT review code directly.

#### Spawn 3 Reviewers

Each reviewer receives a self-contained prompt from a reference file. **Reviewers start with a blank conversation and do NOT auto-load skills.** Read the prompt, substitute variables, and paste it in full.

**Tool Restrictions:** All reviewers are READ-ONLY. Dispatch each with `allowed_tools=["Read", "Glob", "Grep", "Bash(read-only)"]`. Reviewers MUST NOT use Write or Edit tools. They read code, analyze it, and report findings — the main chat handles all fixes.

**Generate the review package ONCE (shared across all lenses):**

The diff is the largest artifact in review. Write it to a file ONCE and point every
reviewer at the path — do not paste the diff into three prompts (it parks the most
expensive bytes in context three times over).

```bash
# BASE = the commit before this implementation began (the task/level base SHA you
# recorded — NOT HEAD~1, which drops all but the last commit of a multi-commit task).
bash ${CLAUDE_SKILL_DIR}/../../scripts/dev/review-package.sh <BASE_SHA> HEAD
# prints: wrote .planning/handoff/review-<base>..<head>.diff  (.planning/ excluded)
```

**Before spawning, substitute these variables in each prompt:**
- `REVIEW_PACKAGE_PATH` -> the path review-package.sh printed (each reviewer reads it ONCE; do NOT paste the diff)
- `SPEC_CONTEXT` -> relevant sections of .planning/SPEC.md (paste inline, do NOT reference file)
- `LEARNINGS_TEST_OUTPUT` -> test output from .planning/LEARNINGS.md (paste actual output)
- `PLUGIN_ROOT` -> resolved base directory for skill paths (relative to this skill's base directory)

**Reviewer prompts (read, substitute variables, send as message):**

| Reviewer | Focus | Prompt Source |
|----------|-------|---------------|
| 1. Security | Vulnerabilities, auth, data exposure, crypto | `references/security-reviewer.md` |
| 2. Performance | Complexity, queries, memory, hot paths | `references/performance-reviewer.md` |
| 3. Tests | Coverage, correctness, reliability, E2E | `references/tests-reviewer.md` |

---

### 4. Lead Monitoring

While reviewers work, the lead:

- **Watches for completion messages** from all 3 reviewers
- **Does NOT review code directly** - your job is coordination and reconciliation
- **If a reviewer asks a question:** Answer it, then broadcast to other reviewers if relevant
- **If a reviewer is taking significantly longer than others:** Message them for status
- **When all 3 reviewers complete:** Proceed to reconciliation

### 5. Reconciliation Protocol (3 Passes)

**Post-subagent boundary (the highest-risk moment).** During reconciliation the lead *consolidates findings* — it does NOT re-review the code or fix anything:

| Lead CAN (verification/coordination) | Lead CANNOT (investigation/fixing) |
|--------------------------------------|------------------------------------|
| Read reviewer findings, dedup, prioritize | Re-read source to second-guess a finding |
| Record verdict in REVIEW_STATE.md | Edit code to fix an issue a reviewer raised |
| Route CHANGES_REQUIRED back to dev-implement | Grep the codebase to build a new finding the reviewers missed |

Fixes are dev-implement's job, never the review lead's. (Full rule: auto-loaded `verification-vs-investigation` / `delegation-law` constraints.)

After ALL reviewers message completion, the lead performs three passes:

<EXTREMELY-IMPORTANT>
**Pass 1 -- Deduplication:**

Multiple reviewers may find the same issue (e.g., input validation gap found by both Security and Tests reviewers).

1. Read all reviewer findings
2. Group by file and line number
3. Identify duplicates:
   - Same file:line
   - Same root cause (even if described differently)
4. Merge duplicates:
   - Keep the highest confidence score
   - Combine descriptions if both add value
   - Attribute to both reviewers

**Example:**
```
Security found: "file.py:42 - Input not validated (Confidence: 85)"
Tests found: "file.py:42 - Missing test for invalid input (Confidence: 80)"

-> Merge: "file.py:42 - Input validation missing + no test coverage (Confidence: 85, found by Security + Tests)"
```

**Pass 2 -- Prioritization:**

Not all issues are equally important. Rank by:

1. **Severity x Confidence:**
   - Critical (90-100 confidence) > Important (80-89)
   - Security > Performance > Tests (when confidence is equal)
2. **Impact on users:**
   - User-facing > Internal
   - Data loss risk > Slowness > Test gaps
3. **Fix effort:**
   - Quick wins (< 30 min) should be fixed now
   - Large refactors (> 2 hours) should be filed as tech debt

Create final prioritized list:
```
1. [CRITICAL] Security: XSS in user input (Confidence: 95)
2. [CRITICAL] Tests: User workflow untested (Confidence: 90)
3. [IMPORTANT] Performance: N+1 query in hot path (Confidence: 85)
4. [IMPORTANT] Tests: Error path missing coverage (Confidence: 80)
```

**Pass 3 -- Integration Check:**

Proposed fixes may conflict with each other.

1. Read each reviewer's suggested fixes
2. Check for conflicts:
   - Do two fixes modify the same code?
   - Does one fix introduce a problem the other reviewer would flag?
   - Do fixes require contradictory approaches?
3. If conflicts exist:
   - Design a unified fix addressing both concerns
   - OR: Flag the conflict and ask reviewers for input

**Example conflict:**
```
Security: "Add input validation on every field"
Performance: "Batch validate to reduce overhead"

-> Unified: "Batch validate with early exit on first invalid field (security + performance)"
```

**If ANY pass finds conflicts -> resolve before reporting final verdict.**
</EXTREMELY-IMPORTANT>

### 6. Final Verdict

After reconciliation, the lead reports:

```markdown
## Parallel Code Review: [Feature Name]

Reviewed by: Security, Performance, Tests

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
All 3 reviewers approved with no issues >= 80 confidence.

[If CHANGES REQUIRED]
X critical and Y important issues must be addressed. Return to /dev-implement.
```

## After Parallel Review

Parallel review produces a *primary* verdict — it is not a terminal state. Do
NOT invoke dev-verify or write `status: APPROVED` from here.

Go to [Phase Complete](#phase-complete) and follow it for every verdict.
Phase Complete is the single authority that runs the Codex second pass, writes
`.planning/REVIEW_STATE.md`, and invokes dev-verify.

A branch-local "APPROVED → dev-verify" shortcut would let the parallel path
reach verification without the second pass ever running, being declined, or
being recorded — which is exactly the bypass the second pass exists to prevent.

---

<EXTREMELY-IMPORTANT>
## The Iron Law of Review

**You MUST report only issues with >= 80% confidence. This is not negotiable.**

Before reporting ANY issue, complete these verification steps:
1. Verify it's not a false positive
2. Verify it's not a pre-existing issue
3. Assign a confidence score
4. Report only if score >= 80

You MUST apply this rule even when encountering:
- "This looks suspicious"
- "I think this might be wrong"
- "The style seems inconsistent"
- "I would have done it differently"

You MUST discard any low-confidence issue found during review.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## The Iron Law of Re-Review

**NO "FIXED" CLAIMS WITHOUT FRESH RE-REVIEW. This is not negotiable.**

When review returns CHANGES REQUIRED and the implementer applies fixes, you MUST:
1. Re-run the SAME review criteria (not lighter, not spot-check)
2. Verify issues are actually resolved (not assumed)
3. Check for new issues introduced by fixes (regression)
4. Only THEN return APPROVED

"I fixed it" without re-reviewing is NOT HELPFUL — unverified fixes ship bugs to the user.

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

**Claiming APPROVED without re-review after fixes is NOT HELPFUL — you're rubber-stamping unverified work that ships bugs to the user.**

### Re-Review Facts

- A re-review after fixes runs the FULL review with the same criteria — spot-checking only the fixed lines misses the regressions a fix introduces elsewhere, which is the failure mode re-review exists to catch.
- At iteration 3 with issues remaining the verdict is ESCALATE, never APPROVED — an approval issued to end the loop is a fabricated verdict, not a judgment.
</EXTREMELY-IMPORTANT>

## Review Focus Areas

### Test Evidence (Check First!)
- [ ] LEARNINGS.md contains actual test command output
- [ ] Tests show PASS/OK (not SKIP, FAIL, or missing)
- [ ] UI changes have screenshot/snapshot evidence
- [ ] All test types run (unit, integration, UI as applicable)
- [ ] E2E tests exist and pass for user-facing changes
- [ ] E2E test simulates actual user flow, not just component render

### Spec Compliance
- [ ] All requirements from .planning/SPEC.md are implemented
- [ ] Acceptance criteria are met
- [ ] No requirements were skipped or partially implemented
- [ ] Edge cases mentioned in spec are handled

### Code Quality
- [ ] Code is simple and DRY (no unnecessary duplication)
- [ ] Logic is correct (no bugs, handles edge cases)
- [ ] Codebase conventions followed (naming, patterns, structure)
- [ ] Error handling is complete
- [ ] No security vulnerabilities detected

## Confidence Scoring

Rate each potential issue from 0-100:

| Score | Meaning |
|-------|---------|
| 0 | False positive or pre-existing issue |
| 25 | Might be real, might not. Stylistic without guideline backing |
| 50 | Real issue but nitpick or rare in practice |
| 75 | Verified real issue, impacts functionality |
| 100 | Absolutely certain, confirmed with direct evidence |

**CRITICAL: Only report issues with confidence >= 80.**

## Required Output Structure

```markdown
## Code Review: [Feature/Change Name]
Reviewing: [files/scope being reviewed]

### Test Evidence Verified
- Unit tests: [PASS/FAIL/MISSING] - [paste key output line]
- Integration: [PASS/FAIL/N/A]
- UI/Visual: [Screenshot taken / Snapshot verified / N/A]

### Critical Issues (Confidence >= 90)

#### [Issue Title] (Confidence: XX)

**Location:** `file/path.ext:line_number`

**Requirement:** [REQ-ID from SPEC.md — every issue MUST trace to a requirement ID]

**Problem:** Clear description of the issue

**Fix:**
```[language]
// Specific code fix
```

### Important Issues (Confidence 80-89)

[Same format as Critical Issues]

### Summary

**Verdict:** APPROVED | CHANGES REQUIRED | BLOCKED (no test evidence)

[If APPROVED]
The reviewed code meets project standards. Tests pass. No issues with confidence >= 80 detected.

[If CHANGES REQUIRED]
X critical issues and Y important issues must be addressed before proceeding.

[If BLOCKED]
Cannot approve without test evidence. Return to /dev-implement and run tests.
```

**If review finds the implementation fundamentally violates the spec (not just minor issues), DELETE the contaminated implementation and return to dev-implement for a fresh attempt. Do not patch a structurally wrong approach.**

### Delete & Restart Protocol

**When implementation deviates fundamentally from spec, DELETE and restart entirely.**

| Situation | Action |
|-----------|--------|
| Code uses wrong protocol/architecture than spec | DELETE. Rewrite from scratch with correct approach. |
| Code implements different approach than PLAN.md | DELETE. User approved specific approach for a reason. |
| Fundamental misunderstanding of requirements | DELETE. Don't patch. Fresh subagent with correct understanding. |
| Patch would require 30%+ of implementation to change | DELETE. Rewrite is cleaner than patching wrong foundation. |

**Why delete instead of patch:** Patching a structurally wrong approach creates technical debt. Fresh implementation from correct architecture is faster than fixing wrong foundation.

**When to patch instead:** Bug in otherwise-correct implementation, missing edge case, performance tweak, minor deviation that doesn't affect core behavior.

**The test:** If the subagent says "oh, I misunderstood the whole approach" → DELETE and restart.

## Agent Invocation

Spawn Task agent for review execution:

```
Task(subagent_type="general-purpose",
     allowed_tools=["Read", "Glob", "Grep", "Bash(read-only)"]):
"Review implementation against .planning/SPEC.md.

**Tool Restrictions:** You are READ-ONLY. You MUST NOT use Write or Edit tools. You read code, check test evidence, and report issues — you do NOT fix them. The main chat handles all fixes.

FIRST: Check .planning/LEARNINGS.md for test output.
Return BLOCKED immediately if no test output is found.

Complete single-pass review covering:
1. Test evidence - tests actually run and pass?
2. Spec compliance - all requirements met?
3. Code quality - simple, correct, follows conventions?

Confidence score each issue (0-100).
Report only issues with >= 80 confidence.
Return structured output per /dev-review format."
```

## Review Facts

- An APPROVED verdict asserts three things: tests actually ran, the output shows PASS (not SKIP, not assumed), and the evidence was verified by the reviewer rather than trusted from a report. An APPROVED with any leg missing is a fabricated verdict — review is the last gate before bugs ship, and BLOCKED is the honest answer when evidence is absent.
- During reconciliation the controller dedups and prioritizes; it does not get to drop a reviewer's qualifying finding or pre-rate its severity down. A finding suppressed at reconciliation ships the bug with the review's sign-off attached — the one outcome review exists to prevent. (Conflicts between lenses get a *unified* fix in Pass 3, never a silent deletion.)
- A rationale a reviewer or implementer offers ("it's intentional", "covered elsewhere") is a claim to verify against the diff and SPEC, never a reason to downgrade the finding. Lowering severity on the strength of an unverified rationale is trusting the report — the exact failure the read-only-reviewer design rules out.
- A finding the diff cannot settle is labeled **"Cannot verify from diff"** with the missing context named — not silently dropped and not guessed into Critical. Dropping it understates risk; inventing a verdict fabricates one; naming the gap is the honest reviewer move and routes the right follow-up.
- Every lens reads the SAME review package file (one `review-package.sh` run), so re-deriving the diff per reviewer (or pasting it per prompt) is wasted turns and wasted context for an identical artifact — generate once, share the path.

## Quality Standards

- **Test evidence is mandatory** - do not approve without test output
- Do not report style preferences lacking project guideline backing
- Do not report pre-existing issues (confidence = 0)
- Make each reported issue immediately actionable
- Use absolute file paths with line numbers in reports
- Treat uncertainty as below 80 confidence

## Gate: Exit Review Loop

**Checkpoint type:** human-verify (test evidence and confidence scores are machine-verifiable)

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

**If iteration >= 3 and you're returning CHANGES REQUIRED instead of ESCALATE, you're ignoring the iteration limit — escalate to the user instead of looping forever.**

## Phase Complete

**Phase summary (append to LEARNINGS.md):**

```yaml
## Phase: Review

---
phase: review
status: completed
implements: []          # review verifies; implements no new requirement IDs
requires: [VALIDATION.md, LEARNINGS.md]
provides: [REVIEW_STATE.md, review-verdict]
affects: []             # read-only review; fixes happen in dev-implement
verdict: APPROVED | CHANGES_REQUIRED | ESCALATE | BLOCKED
iterations: N
issues-found: X (Y critical, Z important)
codex-second-pass: completed | declined | unavailable | error | error
---
```

After review completes, handle verdict-specific transitions:

### If APPROVED (no issues >= 80 confidence)

**STOP — run the [Codex Second Pass](#codex-second-pass) first.** A primary
APPROVED is a candidate verdict, not a final one. Writing `status: APPROVED`
before the second pass runs would hand dev-verify a gate that no second reviewer
ever saw — the second pass would be decorative, and the diff would ship reviewed
once by the same model family that wrote it.

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

**This is hook-enforced, not advisory.** dev-verify gates Agent dispatch on
`GATE_REQUIRE_FIELDS=codex_second_pass:completed|declined|unavailable`, so verify
cannot start until this field records one of those three. Substitute a single
value — pasting the `completed | declined | unavailable` line verbatim matches
nothing and the gate blocks it.

The `status: APPROVED` line is the structural gate dev-verify checks — only an APPROVED review admits verification. On non-approved paths (CHANGES_REQUIRED / ESCALATE / BLOCKED) set `status:` to that verdict so the gate correctly blocks.

Immediately invoke dev-verify:

Read `${CLAUDE_SKILL_DIR}/../../skills/dev-verify/SKILL.md` and follow its instructions.

### If the Codex second pass errored

Codex ran but produced no verdict (non-zero exit, unparseable output). **This is
not an approval and not a rejection — it is an absence of evidence.** Do NOT
write `status: APPROVED` and do NOT invoke dev-verify.

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
    {"label": "Approve without it", "description": "Record codex_second_pass: declined and proceed to dev-verify on the primary review alone. The diff is reviewed by Claude only."}
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

Return to `/dev-implement` with specific issues. **Implementer MUST re-invoke /dev-review after fixes.**

When the blocking findings came from the second pass, say so in the handoff
("Codex second pass, REQ-AUTH-01, confidence 92") — the implementer needs to
know which reviewer to satisfy.

**Critical:** When implementer returns claiming "fixed", you MUST re-run the FULL review. No shortcuts.

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
1. Accept current state and proceed (issues become tech debt)
2. Extend review (manual approval for iteration 4+)
3. Rethink approach (return to /dev-design)

Which option do you prefer?
```

### If BLOCKED (no test evidence)

Return immediately to `/dev-implement` to collect test evidence. Do NOT increment iteration counter - no review occurred.

## Workflow Continuity After Review

| Verdict | Next Action | Iteration Counter |
|---------|-------------|-------------------|
| APPROVED (primary) | Run the [Codex Second Pass](#codex-second-pass) before writing `status: APPROVED` | No change (not a terminal verdict) |
| APPROVED (second pass done/skipped) | Invoke /dev-verify immediately, mark task `[x]` in PLAN.md | Reset to 1 for next task |
| CHANGES REQUIRED | Return to /dev-implement, implementer fixes then re-invokes /dev-review | Increment |
| ESCALATE | Ask user for direction | Keep at max |
| BLOCKED | Return to /dev-implement for test evidence | No change (no review ran) |

**Do NOT pause between review completion and next action.** The workflow is sequential.
