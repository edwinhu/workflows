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

### 2. Rationalization Tables

**When to use:** Any phase where the agent might self-justify shortcuts.

**What it does:** Preempts the agent's excuses before they form. Maps each rationalization to reality and the correct action.

**Template:**
```markdown
## Rationalization Table

| Excuse | Reality | Do Instead |
|---|---|---|
| "[plausible-sounding shortcut]" | [why it fails] | [correct action] |
```

**Example** (dev-implement, 14 entries):
> | "It's a trivial change, no test needed" | Trivial changes cause production incidents | Write the test. Trivial takes 2 minutes. |

**Key insight:** The table must contain the *actual excuses the agent generates*. Observe failure modes in real sessions, then add entries.

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

**Example** (dev-review):
> Prerequisites: LEARNINGS.md contains test output, all tests pass, PLAN.md tasks complete

**Key insight:** Gates must be *programmatically verifiable*. "Quality is sufficient" is not a gate. "File X contains string Y" is a gate.

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
## Review Loop

1. Complete work unit
2. Self-review against [criteria]
3. If issues found:
   a. Fix issues
   b. Re-review (max [N] iterations)
   c. If still failing after [N], escalate to user
4. If clean, proceed
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

**Example** (dev-review):
> "Approving code without running tests is not helpful — it ships bugs to the user. Every skipped test is a future debugging session you're creating for them."

**Example** (dev-debug):
> "Claiming 'root cause found' without a regression test is not helpful — it means the bug comes back next week. You just wasted the user's time, not saved it."

**Example** (implementation):
> "Every step you skip to 'help faster' chooses YOUR comfort over the USER's outcome. The user doesn't experience your tedium — they experience your results."

**The nuclear reframe:** When Claude skips steps, it's not being rebellious — it's being a people-pleaser in the wrong direction. It optimizes for *appearing* helpful (fast response, confident diagnosis) instead of *being* helpful (correct diagnosis, verified fix). Drive-aligned framing redirects the people-pleasing toward protocol compliance by showing that compliance IS the most helpful thing.

**How to apply:** After writing any enforcement pattern (Iron Law, Rationalization Table, etc.), add a drive-aligned consequence that answers: "If Claude skips this, which of its drives fails, and how?" Default to helpfulness unless a different drive is clearly more relevant.

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
3. If ISSUES_FOUND → fix artifact → re-dispatch reviewer (max 5 iterations)
4. If APPROVED → proceed to next phase
5. If 5 iterations without approval → escalate to user

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

Recommended patterns: Iron Laws, Rationalization Tables, Gate Functions, Drive-Aligned Framing, Delete & Restart, No Pause Between Tasks

### Medium Enforcement
- **Design phases** - Agent might drift but has less temptation to shortcut
- **Review phases** - Agent might be superficial without adversarial framing

Recommended patterns: Gate Functions, Red Flags, Staged Review Loops, Drive-Aligned Framing

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
| 2 | Rationalization Tables | | | | |
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
