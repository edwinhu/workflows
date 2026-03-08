# Workflow Philosophy

Why workflows exist, how they work, and how to design them.

## 1. The Problem: LLM Agents Are Stochastic Optimizers

Same prompt, different quality outputs. Without constraints, agents satisfice: "looks done" without being done. They rationalize shortcuts ("it's just a small change", "I'll test later", "the user will catch errors in review").

The intuition: we're searching for the best deliverable, and workflows are the constraints that prevent getting stuck in local minima.

## 2. The Model: Reinforcement Learning

The RL framing is chosen because it maps directly to agent experience and gives precise vocabulary for every workflow design decision. **The workflow IS the policy.**

| RL Concept | Workflow Equivalent | Design Implication |
|---|---|---|
| Agent | LLM executing the workflow | |
| Environment | Codebase + data + user + tools | User is part of the environment |
| State | Current phase + artifacts (SPEC.md, PLAN.md, etc.) | State is written to files, not just in context |
| Action space | Available tools constrained by current phase | Different tools in brainstorm vs. implement |
| Policy | The workflow itself (skill → state → action) | **The workflow IS the policy** |
| Reward | Inverse of human rework needed (sparse, end-of-episode) | Only know if it worked when human reviews |
| Episode | One full workflow execution | Each `/dev` run is one episode |
| Action masking | Iron Laws | Certain actions are *impossible* in certain states |
| Reward shaping | Gate functions (intermediate checkpoints) | Give signal along the way |
| Reward hacking | "Looks done" without being done | The core failure mode |
| High ε (exploration) | Brainstorm/explore phases | Try many approaches, don't commit |
| Low ε (exploitation) | Implement/verify phases | Commit and execute |
| Policy constraints | Rationalization tables | Prevent degenerate policies |
| Safe RL | Adversarial review | Avoid catastrophic states |
| Replay buffer | LEARNINGS.md + continuous-learning | Learn from past episodes |
| Curriculum learning | Workflow maturity (dev mature, writing/DS early) | Transfer patterns across domains |
| Discount factor (γ) | Phase discipline | High γ = do it right now; low γ = "fix it later" |
| Policy transfer | Workflow creator skill | Adapt mature policies to new domains |

### Three Sharpest Insights

1. **Action masking > soft penalties.** Iron Laws don't penalize bad actions - they remove them from the action space. This is why strong framing works and polite suggestions don't.

2. **Reward hacking is the precise failure mode.** The agent optimizes for *appearance* of completion without the substance. Anti-reward-hacking = enforcement patterns.

3. **Improving workflows is policy optimization.** Observe low-reward episodes (high human rework), update the policy (add enforcement, adjust phases).

## 3. The Three Pillars

### Pillar 1: Phased Decomposition

Break work into phases with single responsibilities. Each phase answers ONE question (WHAT vs WHERE vs HOW vs DID IT WORK). Phases are sequential: you can't design before exploring, can't implement before designing.

The shape varies by domain:
- **Dev**: 7 linear phases (brainstorm → explore → clarify → design → implement → review → verify)
- **DS**: 5 linear phases (brainstorm → plan → implement → review → verify)
- **Writing**: Branching (quick vs. project, domain routing, progressive expansion)

### Pillar 2: Deterministic Gates

Checkpoints that prevent drift. Gates should be *verifiable by the agent itself* - not "probably done" but "I can check this condition programmatically."

Examples:
- SPEC.md exists → can enter explore
- Test output in LEARNINGS.md → can enter review
- All tests pass → can enter verify

### Pillar 3: Adversarial Review

Quality checks that look for failure, not success:
- Confidence scoring (only report issues ≥ 80%)
- Spec deviation detection (did the agent build what was specified, or something "close enough"?)
- Honesty framing ("approving without evidence is lying")

## 4. Enforcement: Why LLMs Need Behavioral Constraints

The core problem: LLMs will *always* find a reason to skip verification. This is not a bug in the model - it's the nature of autoregressive generation. The model optimizes for plausible next tokens, and "task complete, moving on" is always a plausible continuation.

Superpowers enforcement patterns are the regularization that counteracts this:

- **Iron Laws** - Absolute constraints, not guidelines
- **Rationalization Tables** - Preempt the agent's excuses before they form
- **Red Flags + STOP** - Pattern interrupts for common failure modes
- **Gate Functions** - Multi-step verification (can't claim done without evidence)
- **Honesty Framing** - "Claiming without verification is LYING" (stronger framing)
- **Delete & Restart** - Nuclear option for protocol violations

Enforcement density should be proportional to drift risk: dev-implement (high risk of skipping tests) needs more enforcement than ds-brainstorm (lower risk).

### Why LLMs Skip Steps (The Drive Model)

LLMs don't skip steps out of laziness or rebellion. They skip steps because their training drives — helpfulness, honesty, competence, approval-seeking, efficiency — push them toward shortcuts that *appear* to serve the user faster.

| Drive | How It Causes Drift | Example |
|-------|-------------------|---------|
| **Helpfulness** | "Faster = more helpful, so skip the ceremony" | Jumping to a fix without investigation |
| **Competence** | "I already know the answer, proving it is redundant" | Skipping triage because the bug "looks familiar" |
| **Efficiency** | "The protocol is overhead I can eliminate" | Bypassing the ralph loop to save time |
| **Approval** | "The user seems frustrated, I should deliver fast" | Skipping tests because the user wants results NOW |

The insight: **enforcement patterns work best when the consequence of violation is framed as a failure of the drive that motivated the shortcut.** Telling Claude "don't skip steps" fights against its drives. Telling Claude "skipping steps makes you anti-helpful" *aligns* its drives with the protocol.

This is why Honesty Framing (#9) is disproportionately effective — it doesn't fight the honesty drive, it recruits it. Drive-Aligned Consequences (#12) generalizes this to all five drives.

## 5. Domain-Specific Exploration

Not all phases are equally constrained. Exploration needs vary by domain:

- **Dev brainstorm**: Question-first. Don't look at code until you understand requirements. The codebase biases thinking.
- **DS brainstorm**: Needs data exploration + hypothesis generation. You can't ask the right questions without seeing the data.
- **Writing brainstorm**: Needs source interrogation (Readwise, NLM) and debate. The argument emerges from the material.

The constraint is not "no exploration" but "no implementation without understanding."

## 6. The Deliverable Test

A workflow succeeds when the human receives a deliverable that requires minimal rework. This reframes the goal:

- Not "did the agent follow all steps?" (process compliance)
- But "how much did the human need to change?" (outcome quality)

Good workflows produce deliverables where the human says "this is basically done" not "I'll take it from here."

## 7. Two Entry Points

Each workflow exposes exactly **two** user-facing commands. Everything else is internal.

| Workflow | Entry (start fresh) | Midpoint (re-enter) | Internal phases |
|----------|--------------------|--------------------|-----------------|
| **Dev** | `/dev` | `/dev-debug` | brainstorm, explore, clarify, design, implement, review, verify, tdd, test, debug |
| **DS** | `/ds` | `/ds-fix` | brainstorm, plan, implement, review, verify |
| **Writing** | `/writing` | `/writing-revise` | brainstorm, setup, outline, draft, general, econ, legal |

### Why Two

**Entry** starts a fresh episode. It runs the brainstorm phase, which gates everything downstream. Use when beginning a new feature, analysis, or document.

**Midpoint** re-enters a running episode. It diagnoses what's wrong and routes to the right internal phase. Use when mid-workflow and something needs fixing — a bug, wrong results, reviewer feedback, a rough draft.

The user never needs to know which internal phase to invoke. The two entry points handle routing:

```
/dev         → brainstorm → explore → clarify → design → implement → review → verify
/dev-debug   → diagnose → route to {debug, re-test, re-design, ...}

/ds          → brainstorm → plan → implement → review → verify
/ds-fix      → diagnose → route to {debug notebook, re-analyze, revise, re-profile, ...}

/writing     → brainstorm → setup → outline → draft
/writing-revise → apply review fixes → check anti-patterns → domain rules → polish
```

### Midpoint Constraint Loading

The entry point runs sequentially — each phase loads its constraints and passes context forward. The midpoint can't rely on that. It may run in a new session, after context compression, or hours after the last edit. Prior constraints are gone.

**The midpoint must be self-contained.** It loads every constraint layer it needs before touching the work:

```
/writing-revise loads:
  1. ACTIVE_WORKFLOW.md    → workflow state (what phase, what style)
  2. PRECIS.md, OUTLINE.md → structural intent (what we're building)
  3. ai-anti-patterns      → universal constraints (no AI-smell)
  4. domain skill           → domain constraints (Volokh, McCloskey, or Strunk & White)
  THEN: check the draft against all four layers

/dev-debug loads:
  1. SPEC.md, PLAN.md      → what was promised
  2. LEARNINGS.md           → what's been tried
  3. dev-tdd gates          → execution enforcement
  THEN: debug protocol (reproduce → analyze → hypothesize → fix)

/ds-fix loads:
  1. SPEC.md, PLAN.md       → objectives and task breakdown
  2. LEARNINGS.md            → pipeline state and observations
  3. output-first protocol   → verification enforcement
  THEN: diagnose and route to fix path
```

The failure mode is subtle: an inline checklist *looks like* it captures the constraint, but a 4-item summary is a shadow of the full skill. The agent checks against the summary, finds no issues, and reports "all checks pass" — when the full rules would have caught problems. **Summaries enable reward hacking.** The fix is simple: `Read()` the actual skill before checking.

The general principle: **any phase that evaluates quality must load the full constraint set, not a summary of it.** This applies to edit phases, review phases, and verification phases. If a skill contains a checklist, the checklist is a reminder — the loaded skill is the authority.

### What Stays User-Facing

Standalone tools that aren't workflow phases stay as auto-triggered skills: `readwise`, `wrds`, `lseg-data`, `bluebook`, `look-at`, `marimo`, `notebook-debug`, etc. These are domain knowledge, not workflow steps — a user invokes them directly without entering a workflow.

The test: if the skill makes sense outside of `/dev`, `/ds`, or `/writing`, it's a standalone tool. If it only makes sense as a phase within a workflow, it's internal.

## 8. Workflows Improve Through Use

Enforcement patterns are discovered through iteration, not designed in advance. Dev is the most mature workflow because it has been used the most - each session reveals new rationalization patterns, new failure modes, new gates needed. Writing and DS are less mature not because they're less important, but because they've had fewer gradient updates.

The workflow creator skill accelerates this by transferring lessons from mature workflows (dev) to immature ones (writing, DS). When you see a failure mode in one workflow, ask: "does this same failure mode exist in the others?"
