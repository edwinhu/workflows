---
name: writing-revise
version: 1.0
description: "This skill should be used when the user asks to 'revise writing', 'fix review issues', 'polish draft', 'apply review feedback', 'complete writing workflow', or after /writing-review produces REVIEW.md with issues to fix."
hooks:
  PreToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: >-
            GATE_ARTIFACT=.planning/REVIEW.md
            GATE_BLOCKED_TOOLS=Write,Edit,Agent
            GATE_DESCRIPTION="Writing review"
            GATE_REMEDY="Run /writing-review first to produce .planning/REVIEW.md before revising"
            uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/phase-gate-guard.py
          # GATE_STATUS intentionally omitted: REVIEW.md carries no status frontmatter,
          # and revise must run whenever REVIEW.md exists (it consumes both CLEAN and
          # ISSUES-FOUND reviews). Existence is the correct trigger; a status gate would
          # deadlock the phase. GATE_BLOCKED_TOOLS closes the Agent-dispatch bypass.
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/writing-suggest-verify.py"
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/writing-claim-id-guard.py"
---

# Writing Revise

The revision loop for writing projects. Consumes `.planning/REVIEW.md` (produced by `/writing-review`) and applies targeted fixes, then completes when the **blocking** issues (critical + major) are resolved — residual minor polish notes are advisory and the writer accepts them at the iteration cap (they do not block completion).

## Shared Enforcement

Auto-load all constraints matching `applies-to: writing-revise`:

!`uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py writing-revise`

**You MUST have these constraints loaded before proceeding. No claiming you "remember" them.**

**CRITICAL:** The `constraint-loading-protocol` above requires loading the domain skill (writing-legal/econ/general) and ai-anti-patterns before revising any prose.

## Session Resume Detection

Before starting, check for an existing handoff:

1. Check if `.planning/HANDOFF.md` exists
2. **If found:** Read it and present to user:
   - Show the phase, section in progress, and Next Action
   - Ask: "Resume from handoff, or start fresh?"
   - If resume: skip to the recorded phase
   - If fresh: proceed with mode detection
3. **If not found:** Proceed normally

## Revise Flowchart (This IS the Spec)

```
START
  │
  ├─ Step 1: Load context (ACTIVE_WORKFLOW, PRECIS, OUTLINE, drafts)
  │
  ├─ Step 2: REVIEW.md exists?
  │  ├─ NO → REFUSE. Suggest /writing-review. EXIT.
  │  └─ YES → Parse issues (critical → major → minor)
  │
  ├─ Step 3: Load constraint layers
  │  ├─ Domain skill (legal/econ/general)
  │  └─ ai-anti-patterns (universal)
  │
  ├─ Step 4: Fix issues in priority order
  │  ├─ 4a: Critical issues (argument-breaking)
  │  ├─ 4b: Major issues (transitions, repetition, late introductions)
  │  └─ 4c: Minor issues (polish)
  │
  ├─ Step 5: Formatting check
  │
  └─ Step 6: Check iteration state (.planning/REVIEW_STATE.md)
     │
     ├─ result.substratePass (0 critical, 0 major) → COMPLETE
     │  └─ Residual MINORS are advisory polish — fix the cheap ones, then Archive → summary → EXIT.
     │     Do NOT loop to drive minors to literal 0 (the prose-reviewer regenerates subjective minors — treadmill).
     │
     ├─ iteration < 3 AND BLOCKING issues remain (critical/major) → CONTINUE
     │  └─ Increment iteration → fix the criticals/majors → Re-invoke /writing-review → Loop
     │
     └─ ESCALATE (decision: user) when EITHER
        ├─ iteration >= 3 AND blocking issues still remain, OR
        └─ substrate clean but minors remain → present them as "accept as-is OR one more polish pass?"
```

If text and flowchart disagree, the flowchart wins.

<EXTREMELY-IMPORTANT>
## IRON LAW: Critique Over Comfort

**If the writing has problems, SAY SO. Being nice is NOT HELPFUL — the user publishes weak prose that gets rejected.**

### Critique Facts

- "Overall flows well" hides section-level problems — each section must be checked against PRECIS claims, and a structural match to the outline says nothing about content quality.
- A checkmark without evidence is an unverified claim presented as verification: reporting "all checks pass" without running every check means the user publishes with undetected problems.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## The Iron Law of Re-Review

**NO "FIXED" CLAIMS WITHOUT FRESH RE-REVIEW. This is not negotiable.**

After applying fixes from REVIEW.md, you MUST:
1. Re-invoke `/writing-review` to regenerate REVIEW.md with fresh diagnostics
2. Verify issues are actually resolved (not assumed)
3. Check for new issues introduced by edits (regressions, new problems)
4. Only THEN claim fixes are complete

"I fixed it" without re-reviewing is NOT HELPFUL — unverified fixes let broken prose reach the user.

### The Audit-Fix Loop (Max 3 Iterations)

```
Iteration 1: Review → REVIEW.md → Revise → Re-Review
              ↓
Iteration 2: Re-Review → REVIEW.md → Revise → Re-Review
              ↓
Iteration 3: Re-Review → REVIEW.md → Revise → Re-Review
              ↓
         Still issues? → ESCALATE to user
         All clean? → COMPLETE
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

**Exit criteria** (gate on the SUBSTRATE — critical + major — not on driving subjective minors to zero):
- **COMPLETE**: `result.substratePass` (0 critical, 0 major) in REVIEW.md. Apply any cheap residual minors, then archive. **Gate type: `human-verify` — auto-advance to archive.** Residual minor polish notes do NOT block completion.
- **CONTINUE**: iteration < 3 AND **blocking** issues remain (critical/major) → fix them, re-invoke /writing-review. **Gate type: `human-verify` — auto-advance.**
- **ESCALATE** `[decision — wait for user]`: iteration >= 3 AND blocking issues still remain (present options); OR substrate is clean but minor polish notes remain — present "accept as-is OR one more polish pass?" The writer decides; do NOT auto-loop on minors.

**Note:** the review still FLAGS every severity (including minors — see the rationalization table; flagging is the reviewer's job). What changed is the loop *exit*: only critical+major **block**; minors are advisory. This is the writing analog of the wc substrate gate — drive the real, convergent findings to zero; don't treadmill on an LLM panel's inexhaustible subjective minors.

**Before claiming "all fixed", check iteration count:**
1. READ `.planning/REVIEW_STATE.md` (create if missing with iteration: 1)
2. If iteration >= 3 and issues remain: ESCALATE (don't say "run review again")
3. If iteration < 3 and issues remain: INCREMENT iteration, re-invoke /writing-review
4. If no issues: COMPLETE

**Claiming "all issues resolved" without re-reviewing is NOT HELPFUL — the user trusts a false "all clear" and publishes with remaining problems.**

### Re-Review Facts

- Revision introduces new errors — fixes cascade into adjacent text, and your eyes glaze over your own edits, so spot-checks and "looks clean" miss what a fresh `/writing-review` catches. Shipping an unverified revised draft asserts a verification that never happened; an unverified claim presented as done is dishonest.
- The rejection-and-rewrite cost far exceeds the re-review cost (a 15-minute re-review vs hours of rework after reviewers reject). Skipping re-review to finish faster is counterproductive on its own terms.
- Hitting the iteration cap with issues remaining means ESCALATE, not approve.
</EXTREMELY-IMPORTANT>

### Revision Facts

- Rewriting an entire section instead of applying the minimum targeted fix introduces new issues and loses the author's voice — destructive ambition, not improvement.
- A fix can break adjacent text; the paragraph before and after the edit must be re-read, and the edited passage itself re-read before the issue is marked fixed — marking it fixed unread is a false completion claim.
- Combining multiple unrelated fixes in one pass makes per-fix verification impossible; one issue at a time.
- "Remembering" the domain rules is guessing — Read() the domain skill every time.

## When to Use

- After `/writing-review` produces `.planning/REVIEW.md`
- When hook suggests it (after ~10 edits)
- Before finishing a writing project

## Prerequisites Gate

Before running edits, verify the workflow is ready:

1. **IDENTIFY**: `.planning/ACTIVE_WORKFLOW.md`, `.planning/PRECIS.md`, `.planning/OUTLINE.md`, and at least one file in `drafts/` must exist
2. **RUN**: Check file existence
3. **READ**: Confirm ACTIVE_WORKFLOW shows `workflow: writing`
4. **VERIFY**: All required files present and draft content exists
5. **CHECK FOR REVIEW.MD**: Look for `.planning/REVIEW.md`

If any file is missing, report and suggest the appropriate phase:
- No PRECIS.md -> `/writing` (start from brainstorm)
- No OUTLINE.md -> writing-setup needed
- No drafts -> writing-draft needed
- **No REVIEW.md** -> suggest `/writing-review` first (see backward-compatibility below)

## Process

### Step 1: Load Context

```
Read(".planning/ACTIVE_WORKFLOW.md")
Read(".planning/PRECIS.md")
Read(".planning/OUTLINE.md")
Read([current draft files in drafts/])
```

If any file is missing, report and suggest starting with `/writing`.

### Step 2: Load REVIEW.md

<EXTREMELY-IMPORTANT>
#### Iron Law: NO REVISION WITHOUT REVIEW.md

**NO REVISION WITHOUT REVIEW.md. This is not negotiable.**

If `.planning/REVIEW.md` does not exist, REFUSE to proceed:

```
REVIEW.md not found. Cannot revise without a structured review diagnosis.

Run /writing-review first to produce .planning/REVIEW.md, then re-run /writing-revise.
```

**STOP HERE. Do not fall back to inline review. Do not offer to "do a quick check instead."**

Why: Inline review is shallow by design — it misses cross-section issues, transition problems, and thesis drift that only hierarchical review catches. Allowing a fallback path means the full review is never run. The review-then-revise pipeline exists because revision without diagnosis produces random edits, not targeted fixes. Small fixes applied without review context create new issues the same way.
</EXTREMELY-IMPORTANT>

**When REVIEW.md exists:**

```
Read(".planning/REVIEW.md")
```

Parse the review into:
- **Critical issues** -- fix first, these break the argument
- **Major issues** -- fix second, these weaken the document
- **Minor issues** -- fix last, these polish the prose

### Step 3: Load Constraint Layers

The midpoint must be self-contained. Load ALL constraint layers before touching the draft:

#### 3a: Load Domain Skill

Based on `style` in ACTIVE_WORKFLOW.md:

| Style | Load |
|-------|------|
| legal | `Read("${CLAUDE_SKILL_DIR}/../../skills/writing-legal/SKILL.md")` |
| econ | `Read("${CLAUDE_SKILL_DIR}/../../skills/writing-econ/SKILL.md")` |
| general | `Read("${CLAUDE_SKILL_DIR}/../../skills/writing-general/SKILL.md")` |

**You MUST Read() the domain skill before editing.** The domain skill contains the full rules, reference material, and enforcement patterns. Editing without it produces generic fixes.

#### 3b: Load Universal Constraints

```
Skill(skill="workflows:ai-anti-patterns")
```

**You MUST load ai-anti-patterns before editing.** This catches AI writing smell (hedging, filler, false balance, weasel words) that domain skills don't cover. Revising without it means you'll fix structural issues while leaving AI-smell intact — the reviewer will flag the same draft again for different reasons.

<EXTREMELY-IMPORTANT>
### Iron Law: Full Constraint Loading

**NO REVISION WITHOUT ALL CONSTRAINT LAYERS. This is not negotiable.**

The midpoint cannot rely on constraints loaded during earlier phases. Prior context may be compressed or lost. You must load:
1. `.planning/ACTIVE_WORKFLOW.md` → workflow state
2. `.planning/PRECIS.md`, `.planning/OUTLINE.md` → structural intent
3. Domain skill → domain-specific rules
4. ai-anti-patterns → universal writing quality

**Editing with only domain skill loaded is like reviewing with one eye closed.** You'll fix half the problems and miss the other half.
</EXTREMELY-IMPORTANT>

### Deviation Rules (Revise Phase)

When applying fixes reveals unplanned issues, follow the deviation rules from `constraints/deviation-rules.md`:

- **R1 (Factual):** Fix reveals a factual error elsewhere → auto-fix: correct and track
- **R2 (Evidence):** Fix requires additional evidence not in the outline → auto-fix: add citation and track
- **R3 (Structural):** Fix breaks a cross-reference or transition → auto-fix: repair and track
- **R4 (Restructuring):** Fix reveals the argument structure is fundamentally broken → **STOP**, present to user, may require returning to outline or PRECIS

Track deviations per fix batch. Report at Step 6: **Deviations during revision:** N auto-fixed (R1: X, R2: Y, R3: Z). **R4 escalations:** [list or "none"].

### Step 4: Fix Issues from REVIEW.md

Work through REVIEW.md issues in priority order:

#### 4a: Critical Issues First

For each critical issue in REVIEW.md:
1. Read the cited location in the draft
2. Understand the diagnosis
3. Apply the suggested fix (or a better one if you see it)
4. Verify the fix resolves the issue without creating new problems

#### 4b: Major Issues

For each major issue:
1. Read the cited location
2. Apply fix
3. Verify

**Transition fixes** (from REVIEW.md "Transition Issues" section):
- Read the boundary summaries for context
- Write bridge text that connects Section N's closing to Section N+1's opening
- Ensure the bridge advances the argument, not just changes the topic

**Repetition fixes** (from REVIEW.md "Cross-Section Repetition"):
- Decide which section should own the point
- Remove or differentiate the duplicate
- Ensure removing the duplicate doesn't leave a gap

**Late introduction fixes** (from REVIEW.md "Concept Introduction Order"):
- Add foreshadowing in the Introduction or earlier section
- Or restructure to move the concept's first substantive use earlier

#### 4c: Minor Issues

For each minor issue:
1. Apply fix
2. Quick verify

### Step 5: Formatting Check

- [ ] Consistent heading styles
- [ ] Citations formatted (Bluebook for legal, journal style for econ)
- [ ] Footnotes properly numbered (if applicable)
- [ ] No orphaned references

### Step 5a (optional): Rhythm-and-flow pass

After REVIEW.md issues are resolved AND the regex sweep (`workflows:ai-anti-patterns` + Strunk + McCloskey + Volokh via `prose-lint.py`) is clean, consider a sentence-level rhythm-and-flow pass for prose-quality issues regex cannot catch — choppy rhythm, weak topic sentences, paragraph closures that trail into roadmaps, sentence-variety deficits.

**When to run:**
- Regex sweep returns 0 hits OR only documented false positives
- User reports the draft "reads choppy" or asks for rhythm review
- Recent edits removed paragraph-closing sentences (roadmap deletions, sentence merges) — rhythm regressions are common after structural edits
- Final pre-circulation polish on a `.docx`

**When NOT to run:**
- Regex sweep has unresolved hits — fix those first (cheaper, mechanical)
- Draft is pre-structural (outline-stage rewrites pending) — rhythm fixes get undone

**Pass infrastructure** (in this skill's directory):
- `references/rhythm-rubric.md` — 5-dimension scoring rubric (rhythm, flow, topic, closure, variety) with geometric-mean overall
- `references/rhythm-auditor-brief.md` — validated agent prompt template
- `references/rhythm-lessons.md` — the 7 design lessons that govern correct execution (read this BEFORE running the pass)
- `scripts/transactional_fix.py` — fix engine with iron-law-of-transactional-save + footnote-pin-respect + structured-fix-targeting enforcement

**Iron Laws** (from `rhythm-lessons.md` — read it; do not run the pass without):
1. Fresh `workflows:writing-prose-reviewer` subagent per iteration (read-only tools)
2. Validate ALL fix needles → apply ALL → save once (no partial saves)
3. Pre-flight footnote/bookmark pin scan; refuse fixes that would orphan citations
4. Structured (paragraph, sentence, dimension, target_text, new_text) fix tuples — no natural-language descriptions
5. Threshold default **8.5** (not 9.5; retrofit work has structural ceilings)
6. Regression alarm distinguishes recalibration (no targeted fix) from collateral damage (targeted fix → drop)
7. Geometric mean for overall score (penalizes worst dimension)

**Invocation pattern:**

```
1. Read rhythm-lessons.md (mandatory — do not skip)
2. Copy rhythm-rubric.md and rhythm-auditor-brief.md to <project>/.planning/prose-rhythm/
3. Run setup: extract draft → CURRENT.md, scan pins → PINS.md, seed SCORES.md + AUDIT.md + CHANGELOG.md
4. Set /goal pinned to "the prose-rhythm pass has CONVERGED — latest .planning/prose-rhythm/SCORES.md row shows ZERO blocking rhythm findings AND overall improved <0.2 vs the prior row (flat) — OR iter ≥ <max_iter>. Stop after <max_iter> turns." (Rhythm is pure judgment with no hard substrate; gate on convergence/flat + zero blocking, NOT on chasing overall ≥ a fixed threshold.)
5. Loop body (one turn each):
   a. Dispatch fresh workflows:writing-prose-reviewer (read-only Read/Grep/Glob)
   b. Read SCORES.md latest row → check convergence (flat ±0.2) + blocking findings + iter + regression alarm
   c. If CONTINUE: uv run --with pyyaml --with lxml python3 ${CLAUDE_SKILL_DIR}/scripts/transactional_fix.py \\
        --draft <path> --state-dir .planning/prose-rhythm --iteration N
   d. End turn (/goal refires)
6. Exit on COMPLETE (zero blocking findings AND overall flat — converged) or ESCALATE (iter ≥ max_iter)
```

**Do NOT invoke as `/prose-rhythm` standalone — it's a subroutine of /writing-revise.** Future work may promote it to a standalone skill if usage demands.

### Step 6: Check Iteration State and Generate Report

Before claiming completion, check the audit-fix loop state:

```
1. READ `.planning/REVIEW_STATE.md` - what iteration are we on?
2. Run final check - are there remaining issues?
3. Determine verdict based on iteration + issues:
   - iteration < 3 AND issues remain → CONTINUE (re-invoke /writing-review)
   - iteration >= 3 AND issues remain → ESCALATE (report to user)
   - no issues → COMPLETE (but first run Step 6a cite-fidelity gate)
```

#### Step 6a: Cite-fidelity hard gate (Stage 3)

<EXTREMELY-IMPORTANT>
**Iron Law: NO COMPLETE WITHOUT CITES-PASSED. Not negotiable.**

If `.planning/ACTIVE_WORKFLOW.md` declares an `nlm_notebook`, every
`drafts/*.md` MUST have a corresponding `.planning/CITES-{slug}.md`
showing `status: PASSED` before the verdict can be COMPLETE.
</EXTREMELY-IMPORTANT>

Before declaring COMPLETE, run Stage 3:

```bash
uv run ${CLAUDE_SKILL_DIR}/../../scripts/cite-fidelity/check_section_cites.py --all
```

Then verify each section:

```python
# For each drafts/*.md, check the matching CITES file
# Slug rule: "Part I (Draft).md" → "CITES-Part-I.md"
import re
from pathlib import Path

drafts = list(Path("drafts").glob("*.md"))
failures = []
for d in drafts:
    slug = re.sub(r"\s+", "-", re.sub(r"\s*\(Draft\)\s*$", "", d.stem).strip())
    cites = Path(".planning") / f"CITES-{slug}.md"
    if not cites.exists():
        failures.append(f"{d.name}: missing CITES file")
        continue
    head = cites.read_text().split("---", 2)
    if len(head) < 3 or "status: PASSED" not in head[1]:
        failures.append(f"{d.name}: CITES status not PASSED")
```

If any failure: return to Step 4 (Fix Issues) addressing the UNSUPPORTED
cites listed in the failing CITES file. Do NOT mark COMPLETE.

If `ACTIVE_WORKFLOW.md` has no `nlm_notebook`, skip this gate (no notebook
to verify against) and proceed with the normal verdict.

See `references/constraints/cite-fidelity-section-gate.md` for the full
doctrine.

Generate report based on verdict:

#### If CONTINUE (iteration < 3, issues remain)

Update `.planning/REVIEW_STATE.md`:

```yaml
---
iteration: [N+1]
max_iterations: 3
last_review_date: [date]
issues_found_count: [count]
verdict: CONTINUE
---
```

**IMMEDIATELY re-invoke /writing-review** (no pause, no user prompt):

Read `${CLAUDE_SKILL_DIR}/../../skills/writing-review/SKILL.md` and follow its instructions.

After /writing-review completes and regenerates REVIEW.md, /writing-revise will be invoked again automatically.

**This is a loop, not a checkpoint.** Do not pause for user input.

#### If ESCALATE (iteration >= 3, issues remain)

Update `.planning/REVIEW_STATE.md`:

```yaml
---
iteration: 3
max_iterations: 3
last_review_date: [date]
issues_found_count: [count]
verdict: ESCALATE
---
```

Report to user:

```
Writing Review Loop Escalation (3 iterations completed)

After 3 review-revise cycles, [N] issues remain:

[List issues from REVIEW.md]

Options:
1. Accept current draft with documented limitations
2. Extend review (manual approval for iteration 4+)
3. Rethink structure (return to outline phase)
4. Human editing (exit workflow, manual fixes)

Which option do you prefer?
```

#### If COMPLETE (no issues found)

Update `.planning/REVIEW_STATE.md`:

```yaml
---
iteration: [N]
max_iterations: 3
last_review_date: [date]
issues_found_count: 0
verdict: COMPLETE
---
```

**SUMMARY**: Append final phase summary to `.planning/PHASE_SUMMARY.md` (see `constraints/phase-summary-frontmatter.md`):
- phase: revise
- artifacts_produced: [list all modified drafts/*.md files]
- provides: [final drafts/*.md]
- deviations: {r1: X, r2: Y, r3: Z, r4: W}
- Include substantive one-liner with total iterations and final verdict (NOT "Revision complete")

Archive workflow state:

```bash
mkdir -p .planning/completed-workflows
mv .planning/ACTIVE_WORKFLOW.md ".planning/completed-workflows/$(date +%Y-%m-%d)-writing.md"
```

Generate completion summary:

```markdown
## Writing Workflow Complete

**Project**: [directory name]
**Completed**: [date]
**Style**: [legal | econ | general]

### Artifacts
- `.planning/PRECIS.md` - Thesis, audience, claims
- `.planning/OUTLINE.md` - Document structure
- `.planning/REVIEW.md` - Final review diagnosis
- `outlines/` - Detailed section outlines
- `drafts/` - Final prose

### Document Summary
- **Thesis**: [from PRECIS.md]
- **Sections**: [count]

### Next Steps
- Export to Word: `/docx`
- Export to PDF: `/pdf`
- Start new project: `/writing`
```
