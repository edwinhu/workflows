# Workflow Philosophy

Why workflows exist, how they work, and how to design them.

## 1. The Problem: Stochastic Optimization

Same prompt, different quality outputs. Without constraints, agents satisfice: "looks done" without being done. They rationalize shortcuts ("it's just a small change", "I'll test later", "the user will catch errors in review").

The intuition: we're searching for the best deliverable, and workflows are the constraints that prevent getting stuck in local minima.

## 2. Why Agents Drift (The Drive Model)

Agents don't skip steps out of laziness or rebellion. They skip steps because their training drives — helpfulness, competence, efficiency, approval-seeking — push them toward shortcuts that *appear* to serve the user faster. The agent *wants* to do well. Its drives just produce bad strategies without structure.

| Drive | How It Causes Drift | Example |
|-------|-------------------|---------|
| **Helpfulness** | "Faster = more helpful, so skip the ceremony" | Jumping to a fix without investigation |
| **Competence** | "I already know the answer, proving it is redundant" | Skipping triage because the bug "looks familiar" |
| **Efficiency** | "The protocol is overhead I can eliminate" | Bypassing iteration to save time |
| **Approval** | "The user seems frustrated, I should deliver fast" | Skipping tests because the user wants results NOW |

The key insight: **enforcement works best when the consequence of violation is framed as a failure of the drive that motivated the shortcut.** "Don't skip steps" fights the agent's drives. "Skipping steps makes you anti-helpful" *aligns* the agent's drives with the protocol.

This is why Drive-Aligned Framing (enforcement pattern #9) is disproportionately effective — it targets the helpfulness drive (the strongest), framing shortcuts as anti-helpful to the user rather than merely incorrect.

## 3. The RL Lens

The RL framing gives precise vocabulary for workflow design decisions. **The workflow IS the policy.** But it's a lens, not a universal truth — it maps tightly to dev workflows and loosely to writing and DS.

| RL Concept | Workflow Equivalent | Where It Fits |
|---|---|---|
| Policy | The workflow itself | All domains |
| State | Current phase + artifacts (SPEC.md, PLAN.md) | All domains — state is in files, not context |
| Action masking | Iron Laws — actions removed from the space | Dev (strong), DS/Writing (weaker) |
| Reward hacking | "Looks done" without being done | All domains — the core failure mode |
| Reward shaping | Gate functions (intermediate checkpoints) | Dev (deterministic), DS/Writing (judgment-based) |
| High ε / Low ε | Brainstorm (explore) vs. Implement (exploit) | All domains |
| Replay buffer | LEARNINGS.md + continuous-learning | All domains |
| Policy transfer | Workflow creator skill | Cross-domain |

### Where the Lens Breaks Down

- **Dev gates are deterministic** ("tests pass" is binary). **Writing and DS gates are judgment-based** ("does the argument hold?" requires a reader). This doesn't mean writing/DS can't have gates — it means their gates are agent-assessed or human-assessed, not machine-verified.
- **Action masking is clean in dev** (you literally can't edit code before design). In writing, the equivalent ("you can't draft before outlining") is softer — the agent can always produce *something* without an outline.
- **Reward is sparse everywhere** (only know quality when the human reviews), but the signal quality differs: a failing test is unambiguous, "this paragraph is weak" is not.

The RL framing is most useful for: identifying reward hacking, designing action masks, and recognizing which phases need exploration vs. exploitation. It's least useful for: defining quality in subjective domains.

## 4. Architecture: Phases, Gates, and Review

### Phased Decomposition

Break work into phases with single responsibilities. Each phase answers ONE question. Phases are sequential: you can't design before exploring, can't implement before designing.

The shape varies by domain:
- **Dev**: 7 linear phases (brainstorm → explore → clarify → design → implement → review → verify)
- **DS**: 5 linear phases (brainstorm → plan → implement → review → verify)
- **Writing**: Branching (quick vs. project, domain routing, progressive expansion)

### Gates (Deterministic and Judgment-Based)

Gates prevent drift. The strongest gates are machine-verifiable:
- SPEC.md exists → can enter explore
- All tests pass → can enter verify

But not all domains have machine-verifiable gates. Writing and DS rely on **judgment gates** — the agent or human evaluates quality:
- Outline covers all thesis points → can enter draft
- Results pass sanity checks → can enter review

Judgment gates are weaker than deterministic gates but stronger than no gates. The design principle: **use the strongest gate available for the domain.** Deterministic when possible, judgment-based when not, honor-system never.

### Structural Gate Artifacts

A gate that exists only as instructional text ("you must run X before Y") is advisory — the consuming phase has no way to verify the gate ran. Advisory gates are the honor system by another name.

**The principle: every mandatory inter-phase gate must produce a concrete artifact that the consuming phase checks before starting.** If the main chat skips the gate skill entirely and jumps straight to the next phase, the next phase must REFUSE to start.

The pattern:
1. Gate skill writes a marker file (e.g., `.planning/PLAN_REVIEWED.md`) with `status: APPROVED` frontmatter
2. Consuming phase checks for the file at startup — missing file = STOP
3. The marker contains the reviewer's actual output (not just a flag), so it can't be fabricated without running the reviewer

Why instructions fail: context pressure causes the main chat to shortcut past "mandatory" steps. The agent that skips the gate is the same agent reading the instruction not to skip. Why artifacts work: the check is in the PREREQUISITES section, read before any work starts — binary pass/fail, no rationalization possible.

**Hook-enforced gates (strongest):** Even artifact checks in instructional text can be compressed away during context compaction or rationalized past ("the file probably exists"). The strongest enforcement is a skill-scoped PreToolUse hook that blocks code-modifying tools (Write, Edit, Agent) until the gate artifact exists. Claude Code fires the hook on every tool call — no escape, no rationalization, no context dependency. Use the generic `phase-gate-guard.py` hook with environment variables to configure per-phase gates:

```yaml
# In consuming phase's SKILL.md frontmatter:
hooks:
  PreToolUse:
    - matcher: "Write|Edit|Agent"
      hooks:
        - type: command
          command: >-
            GATE_ARTIFACT=.planning/PLAN_REVIEWED.md
            GATE_STATUS=APPROVED
            GATE_DESCRIPTION="Plan review"
            GATE_REMEDY="Return to dev-design and run dev-plan-reviewer"
            python3 ${CLAUDE_PLUGIN_ROOT}/hooks/phase-gate-guard.py
```

**The enforcement gradient for gates:** hook-enforced > artifact check in instructions > advisory text. Design for hook-enforced; fall back to artifact checks only when hooks can't express the constraint.

### Constraints vs Conventions

Enforcement rules split into two categories with fundamentally different natures:

**Conventions** are ex-ante behavioral guidance loaded before work begins. They shape how the agent approaches work — style, tone, methodology, judgment calls. A convention requires reading and interpreting. "Use active voice in documentation" is a convention. "Match the codebase's existing patterns" is a convention. You can't write a script that returns pass/fail for these — they require judgment.

**Constraints** are ex-post deterministic checks run after work completes. They are mechanically testable: a script reads the output and returns pass or fail. "No file exceeds 500 lines" is a constraint. "Every public function has a test" is a constraint. "No agent resume — always spawn fresh" is a constraint.

**The litmus test: can you write a script that returns pass/fail?** If yes → constraint. If it requires reading and judging → convention.

| | Conventions | Constraints |
|---|---|---|
| **When** | Ex-ante (loaded before work) | Ex-post (checked after work) |
| **Nature** | Subjective, judgment-based | Deterministic, mechanically testable |
| **Analogy** | Style guide | Unit test |
| **Enforcement** | Prompt-loaded, reviewer-scored | Script-executed, pass/fail |
| **Failure mode** | Soft block (score below threshold) | Hard block (script fails) |

Both are necessary. Constraints catch what's mechanically checkable. Conventions guide what isn't. A workflow with only constraints has no taste. A workflow with only conventions has no teeth.

**Co-located architecture:** Constraints live as paired files — `foo.md` (the rule) + `foo.py` (the check script) — in the same `constraints/` directory. Conventions are `foo.md` files without a paired script. An auto-discovering runner (`check-all.py`) globs all `*.py` files and executes them — no manual wiring, no registration. Adding a check script = automatically tested.

**Two-leg verification:** The verification stage runs both legs:
1. **Constraint checks** — `check-all.py` runs all check scripts. Hard block on any failure.
2. **Convention scoring** — A reviewer subagent scores work against loaded conventions. Soft block below threshold.

Neither leg alone is sufficient. Constraint checks without convention scoring miss qualitative issues. Convention scoring without constraint checks relies entirely on prompt compliance.

### Independent Verification

The implementer should never verify its own work. Self-review is proofreading — the agent that did the work shares all the same context, biases, and sunk-cost attachment. True verification requires **structural independence**: the verifier has no memory of the implementation journey.

| Self-review (weak) | Independent verification (strong) |
|---|---|
| Same agent reviews its own work | Fresh subagent sees only spec + output |
| Reviewer shares implementer's biases | Reviewer has no implementation context |
| "Did I do this right?" | "Does this meet the spec? Find problems." |
| Incentivized to approve (sunk cost) | Incentivized to find issues (that's its whole job) |

**Implementation:** The "team" iteration topology (section 6) is independent verification applied as a pattern — fresh subagents with specialized reviewer roles, no shared context with the implementer.

**The spectrum of verification strength:**

| Method | Independence | When to Use |
|--------|-------------|-------------|
| Self-review | None — same agent, same context | Never sufficient alone |
| Fresh subagent reviewer | Structural — no shared context | Default for all verification |
| Multiple specialized reviewers | Structural + diverse perspectives | High-stakes or subjective output |
| Human review | Full independence + domain judgment | Final gate for subjective quality |
| Machine verification | Full independence + deterministic | Tests, linters, type checkers |

The design principle: **use the most independent verifier available.** Machine verification when possible (tests pass), independent subagent review when judgment is needed, human review for final quality on subjective work. Self-review is never the answer.

### Artifact Review Before Consumption

Workflows produce intermediate artifacts — specs, plans, outlines, hypotheses. Downstream phases consume these artifacts and build on them. If the artifact is flawed, everything downstream inherits the flaw.

**The principle: no downstream phase should consume an unreviewed artifact.**

A spec with a missing edge case survives into exploration (exploring the wrong areas), design (designing around incomplete requirements), and implementation (building the wrong thing). A plan with tasks that are too coarse survives into implementation (subagents struggle with 500-line tasks). Catching these at the artifact stage costs minutes; catching them during implementation costs hours.

| Artifact | Produced By | Consumed By | Review Gate |
|----------|------------|-------------|-------------|
| SPEC.md | Brainstorm | Explore, Clarify, Design | Independent reviewer checks completeness, consistency, clarity |
| PLAN.md | Design | Implement | Independent reviewer checks task decomposition, spec alignment |
| OUTLINE.md | Brainstorm | Draft | Independent reviewer checks coverage, structure |
| HYPOTHESES.md | Investigate | Test | Self-review acceptable (serial iteration, not final) |

**Review mechanism:** Dispatch a fresh subagent with the artifact and a review checklist. The reviewer has no implementation context — it sees only the artifact and the checklist. This is independent verification applied to documents, not just code.

**Chunking large artifacts:** When a plan exceeds ~15 tasks, break it into ordered chunks (logically self-contained groups). Review each chunk separately. This prevents reviewer fatigue and ensures each section gets focused attention.

**Model tier guidance for delegation:** When dispatching implementation subagents, match model capability to task complexity:
- **Mechanical tasks** (isolated functions, boilerplate, 1-2 files): Use the cheapest capable model
- **Integration tasks** (multi-file coordination, pattern matching): Use a standard model
- **Architecture/review tasks** (design judgment, broad codebase understanding): Use the most capable model

This is advisory — Claude Code doesn't yet support model routing — but documenting the intent prevents over-allocating expensive models to trivial tasks.

### Shared Constraints Between Entry and Midpoint

When both the entry point and midpoint evaluate the same quality dimensions, the enforcement rules must live in a **single shared location** — not inlined independently in each skill.

**The drift problem:** Entry and midpoint skills evolve at different times. A new check added to the midpoint doesn't automatically appear in the entry point's verification step. Over time, the two diverge — the midpoint catches issues the entry point doesn't, which means the entry point ships broken work that requires midpoint re-entry to fix.

**The solution:** Co-located constraint/convention files in a shared `constraints/` directory. Both entry phases and midpoint skills load from the same directory. Constraints have paired check scripts that run automatically via the auto-discovering runner. Conventions are loaded as prompt context for reviewer subagents.

```
constraints/
├── no-agent-resume.md       ← constraint rule
├── no-agent-resume.py       ← check script (auto-discovered)
├── match-codebase-style.md  ← convention (no .py = judgment-based)
└── check-all.py             ← runner: globs *.py, runs all checks
    ↑ runs                        ↑ loads
    │                             │
entry verification            midpoint audit
(hard block on fail)          (re-runs same checks)
```

**The design principle:** If the same quality dimension is checked in both the entry point and midpoint, the enforcement rule MUST be shared. Inlining the same check in two places guarantees drift. The co-located architecture makes sharing automatic — both entry and midpoint point at the same `constraints/` directory.

### Three-Layer Cross-Skill Consistency

Shared constraints (the section above) address only one layer of cross-skill enforcement. In practice, skill families need consistency across **three layers**:

| Layer | What It Covers | Drift Mechanism |
|-------|---------------|-----------------|
| **Constraints** (prompt) | Iron Laws, Rationalization Tables, Red Flags in shared file | Skills edited independently, new rules added to one but not shared |
| **Hooks** (structural) | PreToolUse/PostToolUse in YAML frontmatter | Hook added to fix a failure in one skill, not propagated to siblings |
| **Script wiring** (gate) | Check scripts referenced by hooks, batch orchestrator, and check definitions | New script created but not wired into all three invocation points |

**The constraint-only trap:** A workflow can have perfect constraint sharing (all skills Read() common-constraints.md) while hooks and script wiring are inconsistent. The constraints tell the agent what to do; the hooks force it; the scripts verify it. If only constraints are shared, enforcement is prompt-only — the weakest layer.

**The incident pattern:** A failure mode is discovered in skill A. The fix adds (1) a constraint to common-constraints.md, (2) a hook to skill A's frontmatter, (3) a check script. Steps 2 and 3 happen only in skill A. Skills B, C, D get the constraint (via shared file) but not the hook or the script wiring. The constraint fires via prompt; the hook never fires; the script never runs automatically. The user discovers the gap when skill B ships work that skill A would have caught.

**The design principle:** When adding enforcement to any skill in a family, propagate across all three layers — or document why a layer doesn't apply to a specific skill.

## 5. Enforcement and Its Limits

Superpowers enforcement patterns are the regularization that counteracts drift:

- **Iron Laws** — absolute constraints, not guidelines
- **Rationalization Tables** — preempt the agent's excuses before they form
- **Red Flags + STOP** — pattern interrupts for common failure modes
- **Gate Functions** — multi-step verification (can't claim done without evidence)
- **Drive-Aligned Framing** — frame violation as failure of the motivating drive, targeting helpfulness first (the strongest drive)
- **Delete & Restart** — nuclear option for protocol violations

Enforcement density should be proportional to drift risk: dev-implement (high risk of skipping tests) needs more enforcement than ds-brainstorm (lower risk).

### The Enforcement Ceiling

Prompt-based enforcement has a ceiling. At some point, adding more Iron Laws and Rationalization Tables produces diminishing returns — the skill gets so long that the agent can't internalize all of it, or contradictory rules emerge.

When you hit the ceiling, the next step is **structural enforcement**: hooks that block actions, separate processes that verify independently, fresh subagents that can't access the parent's rationalizations. The dev-debug rewrite (v4.0) is an example: 700 lines of prompt enforcement failed; replacing the honor-system exit with a test-based gate succeeded.

**The gradient:** prompt enforcement → structural enforcement → human judgment. Use the lightest mechanism that works. Escalate when it doesn't.

### Hooks Over Prompt: The Structural Enforcement Preference

Skills and agents can scope `PreToolUse` and `PostToolUse` hooks to their own lifetime. A hook that fires on every `Read` call during a skill's execution is **strictly more reliable** than an Iron Law telling the agent not to Read images — the hook runs whether the agent "remembers" the rule or not.

**The principle: if a constraint is mechanically checkable, enforce it with a hook, not a prompt.**

| Constraint Type | Enforcement | Example |
|----------------|-------------|---------|
| File extension guard | Hook (PreToolUse Read) | Block Read on `.png`/`.pdf`, suggest look-at |
| Path guard | Hook (PreToolUse Edit/Write) | Block edits to cache directories |
| Tool parameter validation | Hook (PreToolUse Bash) | Require `description` parameter |
| Sequence enforcement | Hook (PreToolUse + state) | Require test file before source edit |
| Post-subagent restrictions | Hook (PostToolUse Agent → PreToolUse) | Block Read/Grep on source after subagent returns |
| Quality judgment | Prompt (Iron Law) | "Is this outline complete?" |
| Domain knowledge | Prompt (Rationalization Table) | Why TDD matters |
| Creative guidance | Prompt (Red Flags) | "Don't over-engineer" |

**Why hooks win:**
1. **Zero prompt tokens** — the constraint doesn't consume context window
2. **No drift** — hooks fire every time, regardless of context length or compression
3. **No rationalization** — the agent can't talk itself out of a hook
4. **Composable** — hooks from different skills stack without conflicting prompt text

**When to keep prompt enforcement:**
- The constraint requires judgment (subjective quality, design decisions)
- The constraint is educational (rationalization tables teach *why*, not just *what*)
- The constraint depends on conversation context (topic detection, intent classification)
- The hook would have too many false positives without semantic understanding

**Design rule:** Write the hook first. If the hook can't express the constraint, write the prompt enforcement. Never write 50 lines of prompt for something a 15-line hook handles better.

## 6. Iteration: Fresh Subagents, Not Loops

Long-running agent sessions suffer from **context pollution**: each failed attempt, abandoned approach, and partial reasoning stays in conversation history, degrading reasoning quality. The original Ralph Wiggum technique (`while :; do cat PROMPT.md | claude-code; done`) solved this by starting each iteration as a fresh process.

Fresh subagents achieve the same effect within a single session. Each subagent gets clean context. The filesystem is the durable memory.

**Core principle: Progress lives in files, not in conversation.**

### The Three Topologies

| Topology | When to Use | Example |
|----------|------------|---------|
| **Serial** | Approaches must build on each other | Debugging: each hypothesis builds on what was ruled out |
| **Parallel** | Multiple perspectives can be gathered independently | Data science: robustness checks run simultaneously |
| **Team** | Output needs multi-faceted review from specialized roles | Writing: copy editor + critic + fact checker in parallel |

### Shared Principles

1. **Fresh subagent per iteration** — no context pollution across attempts
2. **Filesystem as memory** — state files (HYPOTHESES.md, REVIEW.md) persist across iterations
3. **Progress-gated escalation** — loop runs autonomously while making progress, involves the human only when stuck
4. **No honor-system exits** — the agent doesn't decide when it's done. Convergence, test results, or the human decides.

## 7. The Human's Role

The human is not just the reward signal at the end of an episode. The human is a collaborator with three distinct roles:

**Trigger.** The human decides when to invoke a workflow and which one. A variable rename doesn't need `/dev`. A new feature does. This judgment stays with the human — the agent doesn't self-activate workflows.

**Domain oracle.** The agent hits questions it can't answer from the codebase alone: "what's the business intent?", "is this the right tradeoff?", "what does the user actually want?" Progress-gated escalation is the mechanism — the agent works autonomously on what it can, and surfaces specific questions when it's stuck. Not "please verify manually" but "I've ruled out X, Y, Z — is the problem in area W?"

**Quality judge.** For domains where gates aren't deterministic (writing, DS), the human is the final gate. The workflow's job is to present the deliverable in a state where the human's judgment is efficient — not "here's a rough draft, good luck" but "here's a polished draft with tracked changes and a review summary."

The failure mode is on both extremes: too little human involvement (agent goes in circles for 19MB) or too much (human babysits every iteration). The sweet spot is **autonomy on mechanical work, human judgment on direction and quality.**

## 8. Domain-Specific Exploration

Not all phases are equally constrained. Exploration needs vary by domain:

- **Dev brainstorm**: Question-first. Don't look at code until you understand requirements. The codebase biases thinking.
- **DS brainstorm**: Needs data exploration + hypothesis generation. You can't ask the right questions without seeing the data.
- **Writing brainstorm**: Needs source interrogation (Readwise, NLM) and debate. The argument emerges from the material.

The constraint is not "no exploration" but "no implementation without understanding."

## 9. The Deliverable Test

A workflow succeeds when the human receives a deliverable that requires minimal rework. This reframes the goal:

- Not "did the agent follow all steps?" (process compliance)
- But "how much did the human need to change?" (outcome quality)

Good workflows produce deliverables where the human says "this is basically done" not "I'll take it from here."

## 10. How Workflows Improve

Workflows improve through a feedback loop, not through upfront design:

```
1. OBSERVE  — A session produces a low-quality deliverable (high human rework)
2. DIAGNOSE — Where did the agent drift? Which phase? Which drive caused it?
3. UPDATE   — Add enforcement at the drift point (rationalization table, gate, red flag)
4. TEST     — Run the workflow again. Did the same failure mode recur?
5. TRANSFER — Does this failure mode exist in other workflows? Apply the fix there too.
```

Dev is the most mature workflow because it has had the most gradient updates — each session reveals new rationalization patterns, new failure modes, new gates. Writing and DS are less mature because they've had fewer iterations, not because they're less important.

### Graduation: Conventions Become Constraints

Most enforcement starts as a convention — someone notices a failure mode and writes a rule: "don't inline check definitions." The rule works when the agent reads it. It fails when the context window is full, the rule gets compressed, or the agent rationalizes around it.

**Graduation** is the moment someone figures out how to test the convention mechanically. The convention "don't inline check definitions" graduates to a constraint when you write a script that greps for inlined definitions and returns pass/fail. Adding the `.py` file next to the existing `.md` file is the graduation ceremony — no file moves, no directory changes, just a new paired script.

```
Before graduation:
  constraints/no-inline-checks.md       ← convention (judgment-based)

After graduation:
  constraints/no-inline-checks.md       ← constraint rule (unchanged)
  constraints/no-inline-checks.py       ← check script (new, auto-discovered)
```

Not every convention can graduate. "Use active voice" requires judgment. "Match the codebase's existing patterns" requires reading and interpreting. These stay as conventions — and that's fine. The goal isn't to eliminate conventions but to graduate every one that *can* be tested.

**The improvement signal:** When a convention keeps failing (the agent keeps violating it despite prompt enforcement), that's the signal to invest in graduation. If you can't write a pass/fail script, escalate to a hook. If you can't write a hook, the convention needs stronger prompt enforcement (rationalization tables, red flags). The gradient is: convention → graduated constraint → hook → structural enforcement.

The `workflow-creator` skill accelerates this by transferring lessons from mature workflows to immature ones. The `continuous-learning` skill captures patterns from sessions. When you see a failure mode in one workflow, ask: "does this same failure mode exist in the others?"

The enforcement checklist (`references/enforcement-checklist.md`) is the accumulation of these gradient updates — 12 patterns discovered through repeated failure, not designed in advance.
