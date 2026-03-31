# Writing Workflow: Common Constraints

Shared enforcement for ALL writing skills. Each constraint/convention is self-contained in its own file. Skills load the index + specific atomic files relevant to their phase.

**If a constraint and a phase skill disagree, the constraint wins.** Phase skills add phase-specific rules on top of these.

---

## Constraints (Deterministic Rules — paired with check scripts)

| Constraint | File | Check Script | Description |
|------------|------|-------------|-------------|
| Progressive Expansion Hierarchy | [constraints/progressive-expansion-hierarchy.md](constraints/progressive-expansion-hierarchy.md) | `checks/check-progressive-expansion.py` | 4-level hierarchy and 3 Iron Laws (NO OUTLINE WITHOUT PRECIS, etc.) |
| Constraint Loading Protocol | [constraints/constraint-loading-protocol.md](constraints/constraint-loading-protocol.md) | — | NO PROSE WORK WITHOUT ALL CONSTRAINT LAYERS — domain skill + ai-anti-patterns |
| Flowchart Authority | [constraints/flowchart-authority.md](constraints/flowchart-authority.md) | `checks/check-flowchart-authority.py` | Flowchart IS the spec — text is commentary |
| No Pause Between Phases | [constraints/no-pause-between-phases.md](constraints/no-pause-between-phases.md) | `checks/check-no-pause-between-phases.py` | Immediately load next skill after gate passes |
| Progress Gating | [constraints/progress-gating.md](constraints/progress-gating.md) | — | 5+ iterations without progress → STOP and escalate |
| Post-Subagent Enforcement | [constraints/post-subagent-enforcement.md](constraints/post-subagent-enforcement.md) | — | Main chat MUST NOT read drafts or edit prose after subagent returns |
| Topic Change Protocol | [constraints/topic-change-protocol.md](constraints/topic-change-protocol.md) | — | MUST announce pause before responding to off-topic messages |
| Writing STOP Triggers | [constraints/writing-stop-triggers.md](constraints/writing-stop-triggers.md) | — | 8 red flags that bypass workflow structure |
| Drive-Aligned Default | [constraints/drive-aligned-default.md](constraints/drive-aligned-default.md) | — | "If I skip this, does the user's published work get worse?" |
| Context Monitoring | [constraints/context-monitoring.md](constraints/context-monitoring.md) | — | NO NEW PHASE WITHOUT SUFFICIENT CONTEXT — handoff at ≤25% |
| Deviation Rules | [constraints/deviation-rules.md](constraints/deviation-rules.md) | — | R1-R3 auto-fix, R4 STOP for argument restructuring |
| Claim ID Traceability | [constraints/claim-id-traceability.md](constraints/claim-id-traceability.md) | `checks/check-claim-id-traceability.py` | CLAIM-XX IDs must flow from PRECIS through all artifacts |

### Test Runner

Run all constraint check scripts: `scripts/check-all.sh [project-dir]`

Verification phases MUST run `check-all.sh` as the first leg of verification (hard block on failure), then convention scoring via reviewer subagent as the second leg (soft block below threshold).

## Conventions (Behavioral Guidance — scored by LLM/human judgment)

| Convention | File | Description |
|------------|------|-------------|
| Gate Function Standard | [conventions/gate-function-standard.md](conventions/gate-function-standard.md) | 6-step gate pattern: IDENTIFY → RUN → READ → VERIFY → CLAIM → SUMMARY |
| Artifact Review Gates | [conventions/artifact-review-gates.md](conventions/artifact-review-gates.md) | Which artifacts get independent review before crossing phase boundaries |
| Checkpoint Type Classification | [conventions/checkpoint-type-classification.md](conventions/checkpoint-type-classification.md) | human-verify vs decision gates — controls autonomous execution |
| Phase Summary Frontmatter | [conventions/phase-summary-frontmatter.md](conventions/phase-summary-frontmatter.md) | YAML template for .planning/PHASE_SUMMARY.md |
| Iteration Topology | [conventions/iteration-topology.md](conventions/iteration-topology.md) | Per-phase iteration strategy, exit gates, and escalation triggers |
| Autonomous Phase Chaining | [conventions/autonomous-phase-chaining.md](conventions/autonomous-phase-chaining.md) | How phases auto-chain at human-verify checkpoints |
