# Writing Workflow: Common Constraints

Shared enforcement for ALL writing skills. Each constraint/convention is self-contained in its own file. Skills load the index + specific atomic files relevant to their phase.

**If a constraint and a phase skill disagree, the constraint wins.** Phase skills add phase-specific rules on top of these.

---

## Constraints (Deterministic Rules — paired with check scripts)

| Constraint | File | Check Script | Description |
|------------|------|-------------|-------------|
| Progressive Expansion Hierarchy | [progressive-expansion-hierarchy.md](progressive-expansion-hierarchy.md) | `progressive-expansion-hierarchy.py` | 4-level hierarchy and 3 Iron Laws (NO OUTLINE WITHOUT PRECIS, etc.) |
| Constraint Loading Protocol | [constraints/constraint-loading-protocol.md](constraint-loading-protocol.md) | `constraint-loading-protocol.py` | NO PROSE WORK WITHOUT ALL CONSTRAINT LAYERS — domain skill + ai-anti-patterns |
| Flowchart Authority | [constraints/flowchart-authority.md](flowchart-authority.md) | `flowchart-authority.py` | Flowchart IS the spec — text is commentary |
| No Pause Between Phases | [constraints/no-pause-between-phases.md](no-pause-between-phases.md) | `no-pause-between-phases.py` | Immediately load next skill after gate passes |
| Progress Gating | [progress-gating.md](progress-gating.md) | `progress-gating.py` | 5+ iterations without progress → STOP and escalate |
| Post-Subagent Enforcement | [post-subagent-enforcement.md](post-subagent-enforcement.md) | `post-subagent-enforcement.py` | Main chat MUST NOT read drafts or edit prose after subagent returns |
| Topic Change Protocol | [topic-change-protocol.md](topic-change-protocol.md) | `topic-change-protocol.py` | MUST announce pause before responding to off-topic messages |
| Writing STOP Triggers | [writing-stop-triggers.md](writing-stop-triggers.md) | `writing-stop-triggers.py` | 8 red flags that bypass workflow structure |
| Drive-Aligned Default | [drive-aligned-default.md](drive-aligned-default.md) | — | "If I skip this, does the user's published work get worse?" |
| Context Monitoring | [context-monitoring.md](context-monitoring.md) | `context-monitoring.py` | NO NEW PHASE WITHOUT SUFFICIENT CONTEXT — handoff at ≤25% |
| Deviation Rules | [deviation-rules.md](deviation-rules.md) | `deviation-rules.py` | R1-R3 auto-fix, R4 STOP for argument restructuring |
| Claim ID Traceability | [claim-id-traceability.md](claim-id-traceability.md) | `claim-id-traceability.py` | CLAIM-XX IDs must flow from PRECIS through all artifacts |
| Source-Anchored Citations | [source-anchored-citations.md](source-anchored-citations.md) | `check-source-anchored-citations.py` | NO CITATION FROM MEMORY — all cites must trace to verified `references/sources.bib` (pandoc-citeproc with Bluebook CSL) |
| No Bold-Lead Paragraphs | [writing-no-bold-lead.md](writing-no-bold-lead.md) | `writing-no-bold-lead.py` | No `**Bold Header.** Text...` inline-header patterns in prose drafts |
| Topic Sentence Quality | [writing-topic-sentences.md](writing-topic-sentences.md) | `writing-topic-sentences.py` | Topic sentences must state substance — no meta-commentary openers |
| Citation Tense | [writing-citation-tense.md](writing-citation-tense.md) | `writing-citation-tense.py` | Report scholarly arguments in present tense with inline `Author (YEAR) argues that` form |
| Anchored Numbers | [writing-anchored-numbers.md](writing-anchored-numbers.md) | `writing-anchored-numbers.py` | Empirical numbers must be anchored to a Table/Figure within the paragraph |

### Test Runner

Run all constraint check scripts: `scripts/check-all.sh [project-dir]`

Verification phases MUST run `check-all.sh` as the first leg of verification (hard block on failure), then convention scoring via reviewer subagent as the second leg (soft block below threshold).

## Conventions (Behavioral Guidance — scored by LLM/human judgment)

| Convention | File | Description |
|------------|------|-------------|
| Gate Function Standard | [constraints/gate-function-standard.md](gate-function-standard.md) | 6-step gate pattern: IDENTIFY → RUN → READ → VERIFY → CLAIM → SUMMARY |
| Artifact Review Gates | [constraints/artifact-review-gates.md](artifact-review-gates.md) | Which artifacts get independent review before crossing phase boundaries |
| Checkpoint Type Classification | [constraints/checkpoint-type-classification.md](checkpoint-type-classification.md) | human-verify vs decision gates — controls autonomous execution |
| Phase Summary Frontmatter | [constraints/phase-summary-frontmatter.md](phase-summary-frontmatter.md) | YAML template for .planning/PHASE_SUMMARY.md |
| Iteration Topology | [constraints/iteration-topology.md](iteration-topology.md) | Per-phase iteration strategy, exit gates, and escalation triggers |
| Autonomous Phase Chaining | [constraints/autonomous-phase-chaining.md](autonomous-phase-chaining.md) | How phases auto-chain at human-verify checkpoints |
