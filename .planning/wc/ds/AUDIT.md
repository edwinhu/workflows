## Audit: ds

**Composite:** 0 / 10 &nbsp;·&nbsp; **Verdict:** NEEDS WORK &nbsp;·&nbsp; **Threshold:** 9.5 &nbsp;·&nbsp; **Critical findings:** 0


### Architecture Scores (P01-P21)
| ID | Principle | Score | Notes |
|----|-----------|-------|-------|

### Enforcement Coverage (13 patterns)
| Pattern | Status | Weak/Absent in | Note |
|---------|--------|----------------|------|
| Iron Laws | Present | — | All high-drift phases carry <EXTREMELY-IMPORTANT> Iron Laws: ds-implement (SKILL.md:75), ds-fix (SKI |
| Rationalization Tables | Present | — | Explicit tables in all high-drift and medium-drift phases: ds-implement (SKILL.md:138), ds-fix (SKIL |
| Red Flags + STOP | Present | — | Present across all phases at the required tier: ds (SKILL.md:237), ds-plan (SKILL.md:916), ds-implem |
| Gate Functions | Present | — | IDENTIFY/RUN/READ/VERIFY/CLAIM 5-step gates throughout: ds (SKILL.md:248), ds-plan (SKILL.md:982), d |
| Flowcharts as Spec | Present | — | Authoritative ASCII flowcharts with 'this flowchart IS the specification' in all high and medium-dri |
| Staged Review Loops | Weak | ds-implement (per-task methodology review), ds-validate (fix loop) | Macro review loops are bounded (ds-review max 3, ds-validate max 3, reviewers max 5). However, ds-de |
| Delete & Restart | Present | — | Delete & Restart protocol present in all phases that produce executable work: ds-implement (SKILL.md |
| Skill Dependencies | Present | — | Complete cross-phase Read() chain: ds→ds-spec-reviewer→ds-plan→ds-plan-reviewer→ds-implement→ds-vali |
| Drive-Aligned Framing | Weak | ds-plan-reviewer, ds-spec-reviewer | Full 5-drive tables (helpfulness/competence/efficiency/approval/honesty) present in ds-implement (SK |
| Trigger-Only Descriptions | Weak | ds-plan, ds-implement | ds (SKILL.md:3) and ds-fix (SKILL.md:4) have correct trigger-only descriptions. ds-plan (SKILL.md:3) |
| No Pause Between Tasks | Present | — | Explicit <EXTREMELY-IMPORTANT> no-pause enforcement in all execution phases: ds (SKILL.md:300), ds-p |
| Artifact Review Gates | Present | — | Full hook-enforced artifact gate chain: SPEC_REVIEWED.md gates ds-plan (ds-plan:SKILL.md:32), PLAN_R |

### Path Portability
(path portability not scored this run)

### Dynamic-Workflow Migration Candidates
| Phase | Fan-out? | Worker mode | Value driver | Recommend | Note |
|-------|----------|-------------|--------------|-----------|------|
| ds-validate (Phase 3.5) — per-requirement DQ fan-out | ✅ | review | parallelism | already-migrated | ds-validate/SKILL.md Step 5 resolves and calls Workflow({ scriptPath: 'ds-validate-coverage.js', arg |
| ds-review — Parallel Review (Research-Grade) 3-reviewer fan-out | ✅ | review | context | moderate | The 'Parallel review (Research-Grade)' path fans out 3 read-only reviewers (Methodology, Reproducibi |
| ds-plan — parallel data-source profiling (Step 2) | ✅ | review | parallelism | moderate | When profiling 2+ data sources, ds-plan Step 2 fans out one read-only profiling Task agent per sourc |
| ds-plan — Data Pull Profiling gate (Step 5c) per-source fan-out | ✅ | review | parallelism | moderate | Step 5c fires when any source exceeds 50M rows / 500MB and fans out one read-only profiling subagent |
| ds-plan-reviewer — per-chunk review (>15 tasks) | ✅ | review | parallelism | leave | For plans with >15 tasks, ds-plan-reviewer dispatches a reviewer per chunk. However, the current ski |
| ds-review — single-reviewer path | ❌ | review | none | leave | The default single-reviewer path dispatches exactly ONE Task agent for a combined methodology+data q |
| ds-spec-reviewer — single reviewer dispatch | ❌ | review | none | leave | Dispatches a single Agent to review SPEC.md. N=1. No fan-out shape. Leave conversational. |
| ds-verify — reproducibility check | ❌ | review | none | leave | Dispatches a single fresh Task agent for reproducibility verification (re-run + hash comparison + DQ |
| ds (brainstorm) — SPEC.md authoring | ❌ | none | none | leave | Pure conversational user interview (Socratic questioning via AskUserQuestion) followed by SPEC.md wr |
| ds-delegate — per-task analyst/engineer dispatch | ❌ | transform | none | leave | Dispatches one analyst or engineer agent per PLAN.md task sequentially (or optionally in an agent te |

### Critical Gaps
_None._