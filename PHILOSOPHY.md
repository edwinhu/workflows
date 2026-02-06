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

## 7. Workflows Improve Through Use

Enforcement patterns are discovered through iteration, not designed in advance. Dev is the most mature workflow because it has been used the most - each session reveals new rationalization patterns, new failure modes, new gates needed. Writing and DS are less mature not because they're less important, but because they've had fewer gradient updates.

The workflow creator skill accelerates this by transferring lessons from mature workflows (dev) to immature ones (writing, DS). When you see a failure mode in one workflow, ask: "does this same failure mode exist in the others?"
