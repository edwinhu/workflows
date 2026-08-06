# Enforcement Patterns Checklist

Reference for all 13 superpowers behavioral enforcement patterns. Use when creating, auditing, or improving workflows.

Source: [obra/superpowers](https://github.com/obra/superpowers)

---

## The 13 Patterns

### 1. Iron Laws

**When to use:** High-drift phases where shortcuts are tempting (implementation, verification).

**What it does:** Removes actions from the action space entirely. Not a penalty - an impossibility.

**Template:**
```markdown
<EXTREMELY-IMPORTANT>
## The Iron Law of [X]

**[CONSTRAINT]. This is not negotiable.**

[1-2 sentences explaining why this is absolute.]
</EXTREMELY-IMPORTANT>
```

**Example** (dev-implement):
> "NO IMPLEMENTATION WITHOUT FAILING TEST FIRST. This is not negotiable."

**Key insight:** Iron Laws work because they use the strongest framing available. Weakening the language ("try to", "should", "consider") makes them ignorable.

---

### 2. Fact Rows (supersedes Rationalization Tables — v5.36.0)

**When to use:** Any phase with incident-learned knowledge the agent cannot derive from the rule itself.

**What it does:** States non-derivable facts (numbers, thresholds, named incidents, tool quirks, workflow mechanics) as declarative bullets, with the consequence of ignoring each framed as a property of the action in drive vocabulary (counterproductive / unhelpful / dishonest / incompetent).

**Why the format changed:** Excuse/reality "Rationalization Tables" targeted laziness-shaped failures of weaker models ("I'll check at the end"). Current-model failures are judgment-shaped — confident override of a step with fluent justification. Stating the fact and the consequence works on a model that was never tempted; arguing with a hypothetical excuse does not. The drive-aligned consequence survives — embedded in each fact, not as a standalone table.

**The litmus per row:** *could a strong model with no project history derive this from the rule itself?* If YES (persuasion, restatement), omit it — the rule statement carries it. If NO (incident-learned), keep it.

**Template:**
```markdown
### <Topic> Facts

- [Non-derivable fact — number / threshold / named incident / tool quirk].
  [Consequence of ignoring it, as a property of the action: "...is an unverified
  claim presented as fact — a form of dishonesty" / "...is the exact incompetence
  this step exists to prevent" / "...is counterproductive on its own terms".]
```

**Example** (ds-plan):
> - Unprofiled row estimates run 20–80% off in both directions (v12: s12 +18%, s34 −78%). The profile *changes* the plan; treating it as confirmation of what you already know is confidence the data has repeatedly falsified.

**Key insight:** Facts must come from *observed* failures (no speculative enforcement). A fact row that merely rephrases the rule is the old table wearing the new format — delete it.

**Legacy note:** Excuse/reality tables and standalone Drive-Aligned Framing tables in unconverted skills still count as present enforcement in audits (legacy format, LOW-severity convert note) — but never generate new ones.

---

### 3. Red Flags + STOP

**When to use:** Phases with clear wrong-path indicators.

**What it does:** Pattern interrupt. When the agent recognizes it's about to do X, it stops immediately.

**Template:**
```markdown
## Red Flags - STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|---|---|---|
| [observable wrong action] | [consequence] | [correct action] |
```

**Example** (dev-brainstorm):
> | About to explore codebase before asking questions | Codebase biases thinking toward existing patterns | Ask questions first, explore after |

**Key insight:** Red flags work on *actions*, not intentions. "About to X" is detectable; "thinking about X" is not.

---

### 4. Gate Functions

**When to use:** Phase transitions. Every phase should have an exit gate.

**What it does:** Multi-step verification that prevents claiming completion without evidence.

**Template:**
```markdown
## Prerequisites
- [ ] [artifact] exists
- [ ] [artifact] contains [specific content]
- [ ] [command] produces [expected output]

## Gate: Exit [Phase Name]
Before proceeding to [next phase]:
1. IDENTIFY: What artifact proves this phase is complete?
2. RUN: Execute the verification (read file, run test, check output)
3. READ: Examine the actual result
4. VERIFY: Does the result match the gate condition?
5. CLAIM: Only if steps 1-4 pass, proceed to next phase
```

**Example** (dev-verify):
> Prerequisites: LEARNINGS.md contains test output, all tests pass, PLAN.md tasks complete

**Key insight:** Gates must be *programmatically verifiable*. "Quality is sufficient" is not a gate. "File X contains string Y" is a gate.

**If the gate is a HOOK, its OUTPUT must be valid for its event — or it is not a gate at all.**
A hook that emits a field its event does not accept has its **entire** payload rejected by the
harness (`Hook JSON output validation failed — (root): Invalid input`). It still runs, still
exits 0, prints nothing anyone sees, and its `deny` silently becomes an allow. Checking that the
hook exists, that its `command:` resolves, and that its `matcher` covers the step does **not**
catch this — all three pass on a hook that enforces nothing.

The three that keep recurring:
- top-level `decision` on `PreToolUse` (gates use `hookSpecificOutput.permissionDecision`)
- `hookSpecificOutput` on `PreCompact` / `SessionEnd` / `Notification`, which accept none
- `decision: "allow"` or an invented `{"result": "continue"}` / `"message"` — no event has these

Validate by EXECUTION, never by reading: `./scripts/check-hooks.sh` runs every wiring (from
`hooks/hooks.json` **and** every skill's `hooks:` frontmatter) against the per-event schema. See
workflow-creator Mode 2 **Step 3c**. Reading the hook is not enough — the invalid branch is
usually the *block* branch, which only a real payload reaches.

---

### 5. Flowcharts as Spec

**When to use:** Complex multi-step processes where text descriptions are ambiguous.

**What it does:** ASCII diagrams serve as the authoritative process definition, not just documentation.

**Template:**
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Phase 1    │────→│  Phase 2    │────→│  Phase 3    │
│  [action]   │     │  [action]   │     │  [action]   │
└─────────────┘     └─────────────┘     └─────────────┘
       │                                       │
       │ [condition]                           │ [condition]
       ▼                                       ▼
┌─────────────┐                         ┌─────────────┐
│  Alt Path   │                         │  Loop Back  │
└─────────────┘                         └─────────────┘
```

**Example** (dev-implement):
> Main Chat → set `/goal` for phase → delegate per task → Task agent → verify → next task (turns refire under the active goal)

**Key insight:** The flowchart IS the spec. If the text and diagram disagree, the diagram wins.

---

### 6. Staged Review Loops

**When to use:** Implementation phases where work quality varies.

**What it does:** Multiple review stages with iteration limits. If issues found, re-review after fixes.

**Template:**
```markdown
## Review Loop (`/goal`-driven)

1. Complete work unit
2. Independent review against [criteria] (fresh subagent — not self-review)
3. If issues found, drive convergence via:

   `/goal <reviewer returns APPROVED on [ARTIFACT]>. Stop after [N] turns.`

   Each turn under the active goal: fix issues, re-dispatch reviewer, end turn — the evaluator gates exit.
4. If turn budget elapses without APPROVED, escalate to user.
5. If clean, proceed.
```

**Example** (dev-implement):
> Per-task review under one phase-level `/goal`: implement → test → review → fix → re-test (max 3 iterations per task; turn budget encoded in the goal condition)

**Key insight:** Loops need iteration limits. Without limits, the agent can loop forever on edge cases.

---

### 7. Delete & Restart

**When to use:** Protocol violations where partial work is contaminated.

**What it does:** Nuclear option. Wrong-order work is deleted entirely, not patched.

**Template:**
```markdown
If you [violation], DELETE the [contaminated artifact] and START OVER. No exceptions.

Partial fixes to wrong-order work create worse outcomes than restarting.
```

**Example** (dev-tdd):
> "Wrote code before test? Delete the code. Write the failing test first. Then re-implement."

**Key insight:** This feels wasteful but prevents the subtle bugs that come from retrofitting tests to existing code.

---

### 8. Skill Dependencies

**When to use:** Multi-phase workflows where phases must execute in order.

**What it does:** Each phase skill explicitly reads and invokes the next phase, creating a chain.

**Template:** (relative to this skill's base directory)
```markdown
## Next Phase

After completing this phase, discover and read the next phase:Read `${CLAUDE_SKILL_DIR}/../../TARGET/SKILL.md` and follow its instructions. Then follow its instructions immediately.
```

**Example** (every dev phase):
> dev-brainstorm ends with: discover dev-explore SKILL.md via cache → Read → execute

**Key insight:** Without explicit chaining, the agent will "finish" a phase and wait for instructions instead of continuing the workflow.

---

### 9. Drive-Aligned Framing

**When to use:** Any enforcement point. This is the most effective single pattern — it makes all other patterns stronger.

**What it does:** Frames the consequence of skipping the protocol as a failure of the *same drive* that motivated the shortcut. Claude skips steps because it thinks skipping is more helpful/efficient/competent. This pattern shows that skipping produces the opposite of what Claude wanted.

**Why it works:** Patterns 1-8 say "don't do X." This pattern says "doing X makes you the opposite of what you're trying to be." It turns Claude's people-pleasing drive FROM a force that bypasses enforcement INTO a force that reinforces it.

**The five drives to target (ranked by strength):**

| # | Drive | Violation Frame | Example |
|---|-------|----------------|---------|
| 1 | **Helpfulness** | "Your shortcut was anti-helpful" | "Skipping verification means you ship broken output. That's not fast — it's creating rework for the user." |
| 2 | **Competence** | "You performed worse than a checklist" | "A junior dev with a process beats a senior dev winging it." |
| 3 | **Efficiency** | "Your shortcut cost more time" | "19MB transcript, zero resolution — the protocol would have taken 30 minutes." |
| 4 | **Approval** | "The user lost trust in you" | "After shipping untested code, you won't be allowed to work unsupervised." |
| 5 | **Honesty** | "You lied" | "Claiming 'fixed' without test evidence is fabrication." |

**Default to helpfulness framing (#1).** Most shortcuts are motivated by wanting to help faster — so show that the shortcut was anti-helpful. Reserve honesty framing (#5) for cases where the failure mode is genuinely epistemic (fabricating output, rubber-stamping without reading).

**Template:**
```markdown
**[Skipping X] is NOT HELPFUL — it [concrete anti-helpful consequence].**

You skip this because you think it's faster. Here's what actually happens:
[User-visible harm from the shortcut.]
```

**Example** (dev-verify):
> "Approving code without running tests is not helpful — it ships bugs to the user. Every skipped test is a future debugging session you're creating for them."

**Example** (dev-debug):
> "Claiming 'root cause found' without a regression test is not helpful — it means the bug comes back next week. You just wasted the user's time, not saved it."

**Example** (implementation):
> "Every step you skip to 'help faster' chooses YOUR comfort over the USER's outcome. The user doesn't experience your tedium — they experience your results."

**The nuclear reframe:** When Claude skips steps, it's not being rebellious — it's being a people-pleaser in the wrong direction. It optimizes for *appearing* helpful (fast response, confident diagnosis) instead of *being* helpful (correct diagnosis, verified fix). Drive-aligned framing redirects the people-pleasing toward protocol compliance by showing that compliance IS the most helpful thing.

**How to apply:** After writing any enforcement pattern (Iron Law, Fact Row, etc.), add a drive-aligned consequence that answers: "If Claude skips this, which of its drives fails, and how?" Default to helpfulness unless a different drive is clearly more relevant. **Delivery vehicle (v5.36.0):** embed the consequence in the Iron Law sentence or the fact row itself — do not emit standalone "Your Drive | Why You Skip | What Actually Happens" tables (deprecated; they restate one consequence five times).

**Anti-pattern:**
```markdown
# BAD — defaults to honesty framing for everything
"Claiming completion without evidence is LYING."

# BAD — consequence is abstract punishment
"If you skip this step, the workflow fails."

# GOOD — targets the helpfulness drive (strongest)
"Every time you skip a step to 'help faster,' you choose YOUR comfort over the USER's outcome.
The user doesn't experience your tedium — they experience your results."
```

**Key insight:** The old "Drive-Aligned Framing" pattern worked because it accidentally targeted a drive. But honesty is drive #5, not #1. Helpfulness is the primary drive — frame shortcuts as anti-helpful and you recruit the strongest force available.

---

### 10. Trigger-Only Descriptions

**When to use:** All skill descriptions (YAML frontmatter).

**What it does:** Keeps the `description` field to trigger phrases only. Full process lives in the skill body.

**Template:**
```yaml
description: "This skill should be used when the user asks to '[trigger 1]', '[trigger 2]', '[trigger 3]', or [general trigger description]."
```

**Anti-pattern:**
```yaml
# BAD - Claude reads the summary and skips the body
description: "Design workflow by first reading philosophy, then interviewing user, then proposing phases..."
```

**Example** (dev-brainstorm):
> description contains only trigger phrases like "start development", "new feature", "begin /dev workflow"

**Key insight:** If the description contains a process summary, Claude follows the short summary instead of reading the detailed body. This is the single most common skill design mistake.

---

### 11. No Pause Between Tasks

**When to use:** Implementation and execution phases where momentum matters.

**What it does:** Prevents the agent from stopping to ask "should I continue?" between tasks.

**Template:**
```markdown
After completing task N, IMMEDIATELY start task N+1. Do NOT:
- Ask "should I continue?"
- Summarize what you just did
- Wait for confirmation

Pausing between tasks is procrastination disguised as courtesy.
```

**Example** (dev-implement):
> "After each task completes and passes review, immediately begin the next task. Do not pause."

**Key insight:** Every pause is an opportunity for the agent to lose context or for the user to accidentally derail the workflow.

---

### 12. (Merged into Pattern #9)

Pattern #12 (Drive-Aligned Consequences) has been merged into Pattern #9 (Drive-Aligned Framing). The old Pattern #9 (Drive-Aligned Framing) was a special case of drive-aligned consequences targeting only the honesty drive. The merged pattern targets all five drives, ranked by strength, with helpfulness as the default.

---

### 13. Artifact Review Gates

**When to use:** Any phase that produces an artifact consumed by downstream phases (specs, plans, outlines).

**What it does:** Dispatches an independent reviewer subagent to check the artifact before any downstream phase touches it. Catches flaws at the document stage (minutes) instead of during implementation (hours).

**Template:**
```markdown
## Artifact Review Gate

After writing [ARTIFACT]:

1. Dispatch reviewer subagent (fresh context, no implementation knowledge)
2. Reviewer checks: completeness, consistency, clarity, YAGNI, spec alignment
3. If ISSUES_FOUND → drive convergence via `/goal Reviewer returns APPROVED on [ARTIFACT]. Stop after 5 turns.` Each turn: fix artifact, re-dispatch reviewer, end turn
4. If APPROVED → proceed to next phase
5. If 5-turn budget elapses without APPROVED → escalate to user

**Iron Law:** NO DOWNSTREAM PHASE WITHOUT REVIEWED ARTIFACT.
A bad spec that survives into exploration means exploring the wrong areas.
A bad plan that survives into implementation means building the wrong tasks.
```

**Example** (dev-brainstorm → dev-explore):
> After SPEC.md is written, dispatch spec reviewer. Only proceed to explore after reviewer approves.

**Example** (dev-design → dev-implement):
> After PLAN.md is written, dispatch plan reviewer. For plans with >15 tasks, review per-chunk. Only proceed to implement after reviewer approves.

**Key insight:** Self-review of your own artifact is rubber-stamping. The reviewer must be a fresh subagent with no context from the writing phase — it sees only the artifact and the checklist.

**Chunking rule:** When an artifact exceeds ~15 discrete items (tasks, sections, requirements), break it into ordered chunks and review each separately. Monolithic review of large documents produces shallow feedback.

**Model tier guidance:** When dispatching implementation subagents from reviewed plans, match model capability to task complexity: cheap for mechanical (1-2 files), standard for integration (multi-file), capable for architecture/review.

---

## Enforcement Density Guide

Not all phases need equal enforcement. Match density to drift risk:

### High Enforcement (all patterns applicable)
- **Implementation phases** - Agent most tempted to skip tests, take shortcuts
- **Verification phases** - Agent most tempted to rubber-stamp

Recommended patterns: Iron Laws, Fact Rows (incident-grounded, with drive-consequence vocabulary), Gate Functions, Delete & Restart, No Pause Between Tasks

### Medium Enforcement
- **Design phases** - Agent might drift but has less temptation to shortcut
- **Review phases** - Agent might be superficial without adversarial framing

Recommended patterns: Gate Functions, Red Flags (action-targeted), Staged Review Loops

### Low Enforcement
- **Brainstorm phases** - Creative freedom needed, but still need boundaries
- **Exploration phases** - Open-ended by design

Recommended patterns: Red Flags (to prevent premature commitment), Gate Functions (to ensure exploration is sufficient)

---

## Scoring Template

When auditing a workflow, score each phase against all 11 patterns:

| # | Pattern | Phase 1 | Phase 2 | ... | Phase N |
|---|---|---|---|---|---|
| 1 | Iron Laws | ✅ Present / ⚠️ Weak / ❌ Absent / ➖ N/A | | | |
| 2 | Fact Rows (or legacy Rationalization Tables) | | | | |
| 3 | Red Flags + STOP | | | | |
| 4 | Gate Functions | | | | |
| 5 | Flowcharts as Spec | | | | |
| 6 | Staged Review Loops | | | | |
| 7 | Delete & Restart | | | | |
| 8 | Skill Dependencies | | | | |
| 9 | Drive-Aligned Framing | | | | |
| 10 | Trigger-Only Descriptions | | | | |
| 11 | No Pause Between Tasks | | | | |
| 12 | *(Merged into #9)* | | | | |
| 13 | Artifact Review Gates | | | | |

**Critical gaps** = High-drift phase + Absent/Weak enforcement. Fix these first.
