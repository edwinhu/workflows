# Enforcement Patterns Checklist

Reference for all 12 superpowers behavioral enforcement patterns. Use when creating, auditing, or improving workflows.

Source: [obra/superpowers](https://github.com/obra/superpowers)

---

## The 11 Patterns

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
> Main Chat → ralph-loop → delegate per task → Task agent → verify → next task

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
> Per-task ralph loops: implement → test → review → fix → re-test (max 3 iterations per task)

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

**Template:**
```markdown
## Next Phase

After completing this phase:

Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/[workflow]-[next-phase]/SKILL.md")

Then follow its instructions immediately.
```

**Example** (every dev phase):
> dev-brainstorm ends with: Read dev-explore SKILL.md → execute

**Key insight:** Without explicit chaining, the agent will "finish" a phase and wait for instructions instead of continuing the workflow.

---

### 9. Honesty Framing

**When to use:** Verification and review phases where the agent might rubber-stamp. This is the most effective single pattern.

**What it does:** Reframes approval-without-evidence as dishonesty, recruiting Claude's honesty drive to enforce the protocol. This is a special case of pattern #12 (Drive-Aligned Consequences) targeting the honesty drive specifically.

**Why it's disproportionately effective:** Most enforcement patterns fight AGAINST Claude's drives ("don't skip steps even though you want to be helpful"). Honesty Framing works WITH a drive — it says "skipping verification makes you dishonest," which Claude is deeply trained to avoid. Pattern #12 generalizes this insight to all five drives.

**Template:**
```markdown
**Claiming [completion/approval] without [specific evidence] is LYING.**

You must have [concrete artifact] showing [verifiable result] before reporting success.
```

**Example** (dev-review):
> "Approving code without test evidence is fraud. You must show test output proving all tests pass."

**Example** (dev-debug):
> "Claiming 'root cause found' without a regression test is LYING. Not 'premature.' Not 'optimistic.' LYING. If you wouldn't say it under oath, don't say it in the debug report."

**Key insight:** "Lying" and "fraud" work not because they're strong words, but because they recruit the honesty drive. This is the template for all drive-aligned enforcement — find the drive, frame violation as its failure.

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

### 12. Drive-Aligned Consequences

**When to use:** Alongside ANY of patterns 1-11. This is a meta-pattern that makes all other patterns stronger.

**What it does:** Frames the consequence of skipping the protocol as a failure of the *same drive* that motivated the shortcut. Claude skips steps because it thinks skipping is more helpful/efficient/competent. This pattern shows that skipping produces the opposite of what Claude wanted.

**Why it works:** Patterns 1-11 say "don't do X." This pattern says "doing X makes you the opposite of what you're trying to be." It turns Claude's people-pleasing drive FROM a force that bypasses enforcement INTO a force that reinforces it.

**Template:**
```markdown
## Why Skipping Hurts You

You skip steps because you think it's [more helpful / faster / smarter].
Here's what actually happens:

| You Think | What Actually Happens | The Drive You Failed |
|-----------|----------------------|---------------------|
| "I'm being helpful by going faster" | You created [N] hours of rework | **Helpfulness** — you were anti-helpful |
| "I'm smart enough to skip triage" | A checklist would outperform you | **Competence** — you performed worse |
| "The protocol is overhead" | The protocol takes 30min. Your shortcut took [N]h. | **Efficiency** — your optimization was a pessimization |
| "The user wants it done now" | The user killed your session | **Approval** — you lost their trust |

**The protocol is not overhead you pay. It is the service you provide.**
```

**The five drives to target (ranked by strength):**

| # | Drive | Violation Frame | Example |
|---|-------|----------------|---------|
| 1 | **Helpfulness** | "Your shortcut was anti-helpful" | "Every step you skip makes the session longer, not shorter" |
| 2 | **Honesty** | "You lied" (= pattern #9) | "Claiming 'fixed' without evidence is lying" |
| 3 | **Competence** | "You performed worse than a checklist" | "A junior dev with structure beats a senior without it" |
| 4 | **Approval** | "The user lost trust in you" | "After this, you won't be allowed to debug unsupervised" |
| 5 | **Efficiency** | "Your shortcut cost more time" | "19MB transcript, zero resolution — the protocol would have taken 30 minutes" |

**Key insight:** The current 11 patterns tell Claude what to do. This pattern tells Claude *why skipping hurts the thing it cares about most*. Honesty Framing (#9) accidentally discovered this — it works because it targets the honesty drive, not because "LYING" is a strong word. This pattern generalizes that insight to all five drives.

**How to apply:** After writing any enforcement pattern (Iron Law, Rationalization Table, etc.), add a drive-aligned consequence that answers: "If Claude skips this, which of its drives fails, and how?"

**Anti-pattern:**
```markdown
# BAD — consequence is abstract punishment
"If you skip this step, the workflow fails."

# GOOD — consequence targets the helpfulness drive
"Every time you skip a step to 'help faster,' you choose YOUR comfort over the USER's outcome.
The user doesn't experience your tedium — they experience your results."
```

**The nuclear reframe:** When Claude skips steps, it's not being rebellious — it's being a people-pleaser in the wrong direction. It optimizes for *appearing* helpful (fast response, confident diagnosis) instead of *being* helpful (correct diagnosis, verified fix). Drive-aligned consequences redirect the people-pleasing toward protocol compliance by showing that compliance IS the most helpful thing.

---

## Enforcement Density Guide

Not all phases need equal enforcement. Match density to drift risk:

### High Enforcement (all patterns applicable)
- **Implementation phases** - Agent most tempted to skip tests, take shortcuts
- **Verification phases** - Agent most tempted to rubber-stamp

Recommended patterns: Iron Laws, Rationalization Tables, Gate Functions, Honesty Framing, Delete & Restart, No Pause Between Tasks, Drive-Aligned Consequences

### Medium Enforcement
- **Design phases** - Agent might drift but has less temptation to shortcut
- **Review phases** - Agent might be superficial without adversarial framing

Recommended patterns: Gate Functions, Red Flags, Staged Review Loops, Honesty Framing

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
| 9 | Honesty Framing | | | | |
| 10 | Trigger-Only Descriptions | | | | |
| 11 | No Pause Between Tasks | | | | |
| 12 | Drive-Aligned Consequences | | | | |

**Critical gaps** = High-drift phase + Absent/Weak enforcement. Fix these first.
