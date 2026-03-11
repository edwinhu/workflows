# Workflow Audit Reports

Generated: 2026-03-09 | Auditor: workflow-creator Mode 2

---

## Audit 1: Dev Workflow Family

**Entry:** skills/dev/SKILL.md (7-phase: brainstorm → explore → clarify → design → implement → review → verify)
**Midpoint:** skills/dev-debug/SKILL.md (fresh-subagent loop with progress gating)
**Phase skills:** lib/skills/dev-{explore,clarify,design,implement,review,verify}/SKILL.md

### Architecture Scores

| Principle | Score | Notes |
|-----------|-------|-------|
| **Phased decomposition** | 10/10 | 7 clearly separated phases, each with single responsibility. Brainstorm (WHAT), Explore (WHERE), Clarify (WHAT EXACTLY), Design (HOW), Implement (BUILD), Review (CHECK), Verify (PROVE). No overlap. |
| **Gates** | 10/10 | Every phase has explicit 5-step gate functions (IDENTIFY → RUN → READ → VERIFY → CLAIM). Gates are deterministic where possible (SPEC.md exists, tests pass) and judgment-based where needed (user approval in design). Multiple nested gates in implement (pre-flight, per-task, spec deviation). |
| **Independent verification** | 9/10 | Strong structural independence: implement delegates to fresh subagents, review spawns independent reviewer (or 3 parallel reviewers), verify runs fresh tests. One gap: single-reviewer path in review doesn't guarantee full structural independence (it's a subagent but spawned by the same orchestrator). |
| **Two entry points** | 10/10 | Entry (`/dev`) starts at brainstorm. Midpoint (`/dev-debug`) is fully self-contained — loads HYPOTHESES.md and LEARNINGS.md, spawns fresh subagents. Midpoint explicitly forbids main chat from touching codebase (cognitive lock). |
| **Iteration strategy** | 10/10 | Implement: serial one-shot per task with ralph loops. Debug: serial hypothesis testing with fresh subagent per iteration. Review: audit-fix loop (max 3). Progress-gated escalation in debug. Structural exit (test passes, not honor system). |

**Architecture Total: 49/50**

### Enforcement Coverage

| # | Pattern | Brainstorm | Explore | Clarify | Design | Implement | Review | Verify |
|---|---------|-----------|---------|---------|--------|-----------|--------|--------|
| 1 | Iron Laws | ✅ Ask before explore | ✅ Return key files | ✅ Ask before design | ✅ User approval | ✅ TDD + Delegation (2 laws) | ✅ 80% confidence + Re-review | ✅ Fresh evidence |
| 2 | Rationalization Tables | ✅ 7 entries | ✅ 7 entries | ✅ 7 entries | ✅ 7 entries | ✅ 14+ entries | ✅ 7 entries | ✅ 8 entries |
| 3 | Red Flags + STOP | ✅ 4 entries | ✅ 4 entries | ✅ 4 entries | ✅ 4 entries | ✅ | ✅ 6 entries | ✅ 6 entries |
| 4 | Gate Functions | ✅ 5-step | ✅ Multi-gate (test infra + code path) | ✅ Test strategy + REAL test | ✅ 12-step | ✅ Per-task + pre-flight | ✅ 5-step exit loop | ✅ 5-step |
| 5 | Flowcharts as Spec | ✅ Phase overview | ✅ | ➖ | ✅ Gate flowchart | ✅ Delegation chain | ✅ Audit-fix loop | ➖ |
| 6 | Staged Review Loops | ➖ N/A | ➖ N/A | ➖ N/A | ➖ N/A | ✅ Ralph loops | ✅ Max 3 iterations | ✅ Max 3 verify cycles |
| 7 | Delete & Restart | ➖ N/A | ➖ N/A | ➖ N/A | ➖ N/A | ✅ Code before test = delete | ✅ Spec deviation = delete | ✅ Stale evidence = delete |
| 8 | Skill Dependencies | ✅ → explore | ✅ → clarify | ✅ → design | ✅ → implement | ✅ → review | ✅ → verify | ✅ Complete |
| 9 | Honesty Framing | ✅ "Guessing is LYING" | ✅ "Not reading is LYING" | ✅ "Assuming is LYING" | ✅ "Guessing is fiction" | ✅ "Task complete without tests is LYING" | ✅ "Approving without evidence is FRAUD" | ✅ "Claiming without evidence is LYING" |
| 10 | Trigger-Only Descriptions | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 11 | No Pause Between Tasks | ✅ | ✅ | ✅ | ✅ (extensive) | ✅ | ✅ | ➖ Final phase |
| 12 | Drive-Aligned Consequences | ✅ 3-drive table | ✅ 3-drive table | ✅ 3-drive table | ✅ 3-drive table | ✅ 5-drive table | ✅ 5-drive table (×2) | ✅ 3-drive table |

### Critical Gaps

1. **None critical.** The dev workflow is the most mature workflow, having received the most "gradient updates" from real usage. All 12 enforcement patterns are present across all high-drift phases.

### Minor Recommendations

1. **Verify phase lacks a flowchart** — Add an ASCII flowchart showing the verification → user acceptance → complete flow.
2. **Explore uses `Task` instead of `Agent`** in examples — Update tool names to current API (`Agent` tool).
3. **Consider adding E2E gate to brainstorm** — The REAL test definition in brainstorm is thorough but could benefit from a protocol verification checkbox earlier.

**Overall Score: 9.8/10**

---

## Audit 2: DS Workflow Family

**Entry:** skills/ds/SKILL.md (5-phase: brainstorm → plan → implement → review → verify)
**Midpoint:** skills/ds-fix/SKILL.md (diagnose → route → fix → verify)
**Phase skills:** lib/skills/ds-{plan,implement,review,verify}/SKILL.md

### Architecture Scores

| Principle | Score | Notes |
|-----------|-------|-------|
| **Phased decomposition** | 9/10 | 5 clean phases with single responsibilities. Brainstorm (objectives), Plan (profile + tasks), Implement (output-first execution), Review (methodology check), Verify (reproducibility). Slight concern: Plan does both profiling AND task breakdown — could arguably be two phases, but the dependency is tight enough to justify combining. |
| **Gates** | 9/10 | All phases have 5-step gates. Plan has ETL assessment gates. Implement has staleness check on LEARNINGS.md. Review has independent data quality verification (code execution). One gap: brainstorm gate relies on "user confirmed objectives" but doesn't enforce AskUserQuestion was used. |
| **Independent verification** | 9/10 | Review dispatches independent subagent with mandatory code execution (not just reading). Parallel review option with 3 specialized reviewers. Independent data quality checks (empty columns, high-null, duplicates) run as code. One gap: single-reviewer path is a subagent but without structural role separation. |
| **Two entry points** | 9/10 | Entry (`/ds`) starts at brainstorm. Midpoint (`/ds-fix`) loads SPEC, PLAN, LEARNINGS before diagnosis. Routes to 6 categories (runtime error, wrong results, unclear root cause, reviewer feedback, data change, scope change). Competing hypothesis protocol for unclear root causes. Slight gap: midpoint doesn't reload domain-specific enforcement (SAS rules) if applicable. |
| **Iteration strategy** | 9/10 | Implement: serial one-shot per task with delegation. Review: audit-fix loop (max 3 iterations). Verify: max 3 verification cycles. Competing hypothesis: parallel investigation with evidence synthesis. One gap: no explicit progress-gated escalation in implement (relies on review loop). |

**Architecture Total: 45/50**

### Enforcement Coverage

| # | Pattern | Brainstorm | Plan | Implement | Review | Verify |
|---|---------|-----------|------|-----------|--------|--------|
| 1 | Iron Laws | ✅ Ask first | ✅ Spec before plan | ✅ Output-first + Delegation | ✅ 80% confidence + Re-review | ✅ Fresh verification |
| 2 | Rationalization Tables | ✅ 5 entries | ✅ 7 entries + ETL 9 entries | ✅ 5 entries | ✅ 6 entries | ✅ 5 entries |
| 3 | Red Flags + STOP | ✅ 5 entries | ✅ 8 entries | ✅ 10 entries | ✅ 4 entries | ✅ 5 entries |
| 4 | Gate Functions | ✅ 5-step | ✅ 5-step + ETL gates | ✅ Staleness + task count | ✅ 5-step exit loop | ✅ 5-step |
| 5 | Flowcharts as Spec | ✅ Workflow overview | ✅ ETL flowchart | ⚠️ Weak — no ASCII flowchart | ✅ Audit-fix loop | ➖ |
| 6 | Staged Review Loops | ➖ N/A | ➖ N/A | ➖ N/A | ✅ Max 3 iterations | ✅ Max 3 cycles |
| 7 | Delete & Restart | ➖ N/A | ➖ N/A | ✅ Main-chat code = delete | ➖ | ➖ |
| 8 | Skill Dependencies | ✅ → plan | ✅ → implement | ✅ → review | ✅ → verify | ✅ Complete |
| 9 | Honesty Framing | ✅ "Claiming understanding is LYING" | ✅ "Plan without profiling is LYING" | ✅ "Kept main-chat code = lied" | ✅ "Approving without code execution is LYING" | ✅ "Claiming without fresh evidence is LYING" |
| 10 | Trigger-Only Descriptions | ✅ | ✅ | ✅ | ✅ | ✅ |
| 11 | No Pause Between Tasks | ⚠️ Not explicit | ✅ | ✅ (extensive) | ✅ | ➖ Final phase |
| 12 | Drive-Aligned Consequences | ✅ 2-drive table | ✅ 2-drive table | ✅ 2-drive table | ✅ 2-drive table | ✅ 2-drive table |

### Critical Gaps

1. **Implement lacks a flowchart** — The implementation process should have an ASCII flowchart showing the task loop, delegation, and verification cycle. Currently relies on prose description.

2. **Drive-Aligned Consequences are thin** — Most phases have only 2-drive tables (shortcut → consequence). The dev workflow uses full 3-5 drive tables with explicit drive identification. DS should match this pattern for high-drift phases (implement, review).

### Recommendations

1. **Add flowchart to ds-implement** — Show: Read PLAN → For each task → Delegate → Verify output → Log LEARNINGS → Next task.
2. **Expand drive tables to 5-drive format** in implement and review (add Efficiency, Approval, Competence columns).
3. **Add No Pause enforcement to brainstorm** — Currently brainstorm doesn't explicitly enforce no-pause before transition to plan.
4. **Add SAS enforcement reload to ds-fix** — When midpoint entry encounters SAS projects, it should reload `sas-etl.md`.
5. **Add Delete & Restart to review** — If review finds methodology is fundamentally flawed, the protocol should specify delete-and-replan (similar to dev-review's spec deviation detection).

**Overall Score: 9.0/10**

---

## Audit 3: Writing Workflow Family

**Entry:** skills/writing/SKILL.md (routes: quick edit → writing-general, OR project → setup → outline → draft → review → revise)
**Midpoint:** skills/writing-revise/SKILL.md (consumes REVIEW.md, applies fixes, audit-fix loop)
**Phase skills:** lib/skills/writing-{setup,outline,draft,general,legal,econ}/SKILL.md
**Review:** skills/writing-review/SKILL.md (produces REVIEW.md)

### Architecture Scores

| Principle | Score | Notes |
|-----------|-------|-------|
| **Phased decomposition** | 9/10 | Clean progressive expansion: Brainstorm (sources) → Setup (PRECIS + OUTLINE) → Outline (per-section) → Draft (prose) → Review → Revise. Each level expands the previous. Branching for quick vs project mode. Domain routing (legal/econ/general). Minor: brainstorm and setup could arguably be one phase. |
| **Gates** | 8/10 | Setup has 5-step gate (PRECIS, OUTLINE, ACTIVE_WORKFLOW verified). Outline has cross-reference gate. Draft has staged verification. Review has 5-step gate (all 3 levels complete). Revise has iteration tracking. Gap: brainstorm gate relies on conversation review ("has user confirmed?") rather than file-based verification. Writing-general (quick mode) has no formal gate. |
| **Independent verification** | 8/10 | Review uses hierarchical 3-level process (section → transition → document). Parallel review option with per-section agents. Writing-revise invokes /writing-review for re-verification (not self-review). Gap: no independent reviewer role — the same agent does review and revise. In dev, review is structurally independent (fresh subagent). Writing-review does spawn agents for parallel mode but sequential mode is the same agent. |
| **Two entry points** | 9/10 | Entry (`/writing`) routes to quick or project mode. Midpoint (`/writing-revise`) loads all constraint layers (ACTIVE_WORKFLOW, PRECIS, OUTLINE, domain skill, REVIEW.md). Self-contained. Loads full skills, not summaries. One minor gap: writing-revise has backward-compatibility path when REVIEW.md doesn't exist — this weakens the midpoint's constraint enforcement. |
| **Iteration strategy** | 8/10 | Revise: audit-fix loop (max 3 iterations) with REVIEW_STATE.md tracking. Review→Revise→Review loop is well-defined. Gap: outline phase has "no iteration limit" — explicitly stated as unlimited. While intentional (cheap iterations), this could lead to infinite loops without progress gating. Draft phase also lacks iteration limits. |

**Architecture Total: 42/50**

### Enforcement Coverage

| # | Pattern | Brainstorm (writing) | Setup | Outline | Draft | Review | Revise |
|---|---------|---------------------|-------|---------|-------|--------|--------|
| 1 | Iron Laws | ✅ Librarian-only search | ✅ Progressive expansion | ✅ No prose without outline | ✅ No prose without outline + Depth | ✅ Reading + Evidence (2 laws) | ✅ Critique over comfort + Re-review |
| 2 | Rationalization Tables | ✅ 5 entries | ✅ 6 entries | ✅ 5 entries | ✅ 10 entries | ✅ 8 entries | ✅ 10 entries |
| 3 | Red Flags + STOP | ✅ 6 entries | ✅ 5 entries | ✅ 5 entries | ✅ 7 entries | ✅ 8 entries | ✅ 5 entries |
| 4 | Gate Functions | ✅ 5-step | ✅ 5-step | ✅ 5-step | ✅ Staged verification | ✅ 5-step | ✅ Iteration-based |
| 5 | Flowcharts as Spec | ✅ Decision flowchart + workflow overview | ➖ | ➖ | ➖ | ➖ | ✅ Audit-fix loop |
| 6 | Staged Review Loops | ➖ N/A | ➖ N/A | ➖ N/A | ✅ No iteration limit | ✅ Sequential + Parallel options | ✅ Max 3 iterations |
| 7 | Delete & Restart | ➖ N/A | ➖ N/A | ✅ Prose without outline = delete | ✅ Legal/Econ wrong = delete | ➖ | ➖ |
| 8 | Skill Dependencies | ✅ → setup | ✅ → outline | ✅ → draft | ✅ → review/revise | ✅ → revise | ✅ Complete/escalate |
| 9 | Honesty Framing | ✅ "Training data is not research" | ✅ "Vague thesis is LYING" | ✅ "Claiming complete without checking is LYING" | ⚠️ Implicit only | ✅ "All checks pass without evidence is LYING" | ✅ "Reporting without re-review is LYING" |
| 10 | Trigger-Only Descriptions | ✅ | ✅ Internal | ✅ Internal | ✅ Internal | ✅ | ✅ |
| 11 | No Pause Between Tasks | ⚠️ Not explicit | ✅ | ✅ | ✅ | ✅ | ✅ |
| 12 | Drive-Aligned Consequences | ✅ 3-shortcut table | ✅ 1-shortcut | ✅ 1-shortcut | ✅ 3-shortcut | ✅ 3-shortcut | ✅ 5-drive table + 2-shortcut |

### Critical Gaps

1. **Writing-review sequential mode lacks structural independence** — The same agent that reviewed can be the same one that wrote. Unlike dev-review which mandates a fresh subagent, writing-review's sequential mode doesn't enforce fresh-context reviewing. The parallel mode does, but it's optional.

2. **Flowcharts missing from middle phases** — Setup, outline, draft, and review (sequential path) lack ASCII flowcharts. The brainstorm has a good decision flowchart, but the progressive expansion workflow would benefit from a per-phase flowchart.

3. **Draft phase has no explicit honesty framing** — While the Iron Laws are strong, there's no explicit "Claiming the draft is complete without checking depth is LYING" statement equivalent to other phases.

### Recommendations

1. **Add structural independence to writing-review sequential mode** — Mandate spawning a fresh subagent for review even in sequential mode. The reviewer should not share context with the drafter.
2. **Add flowcharts to setup, outline, and draft** — Show progressive expansion visually in each phase.
3. **Add explicit honesty framing to writing-draft** — "Reporting sections complete without verifying every outline point was expanded is LYING about draft quality."
4. **Add progress gating to outline/draft unlimited iterations** — While unlimited iterations are intentional, add a soft escalation: "If 5+ iterations on same section, ask user if scope needs adjustment."
5. **Strengthen drive-aligned consequences** — Most phases use shortcut→consequence tables (2 columns) instead of the 5-drive format. Upgrade high-drift phases (draft, review) to full 5-drive tables.
6. **Add No Pause enforcement to brainstorm** — The entry skill should explicitly say "after user confirms topic, immediately proceed to setup."

**Overall Score: 8.4/10**

---

## Audit 4: Course-Materials (Teaching) Plugin

**Entry:** skills/lecture-prep/SKILL.md (7-phase: ASSESS → INDEX → SLIDES → NOTES → COMPILE → VERIFY → UPLOAD)
**Midpoint:** skills/lecture-prep-edit/SKILL.md (diagnose → fix loop → compile → verify)
**Supporting:** skills/find-slide-page/SKILL.md, agents/reviewer.md, review/checks/{fidelity,coverage,layout}.md

### Architecture Scores

| Principle | Score | Notes |
|-----------|-------|-------|
| **Phased decomposition** | 9/10 | 7 clear phases with strong single responsibility. ASSESS (what exists), INDEX (extract + partition), SLIDES (create per lecture), NOTES (create per lecture), COMPILE (generate PDFs), VERIFY (review), UPLOAD (deploy). Parallel per-lecture subagents for SLIDES/NOTES/VERIFY when 3+ lectures. Minor: SLIDES and NOTES could run in parallel for independent lectures but are sequential by design (notes depend on slides). |
| **Gates** | 9/10 | ASSESS has 5-step gate. INDEX has character-count gate (re-extract if <50%). SLIDES has overflow check gate. NOTES has alignment gate. VERIFY has issue detection → FIX → RECOMPILE → RE-VERIFY loop. Midpoint has 4 mechanical checks (overflow, thin, widow, coverage re-audit). Gap: UPLOAD gate is user-prompted (ask before uploading) but lacks post-upload verification. |
| **Independent verification** | 10/10 | Reviewer agent is a dedicated dispatcher that spawns 3 parallel sub-agents (fidelity, coverage, layout). Each check has its own definition file. Coverage audit in midpoint is ALWAYS delegated to sub-agent (even for 1 lecture). The agent's report IS the evidence — main chat cannot fake it. Strongest independent verification of all four workflows. |
| **Two entry points** | 10/10 | Entry (`/lecture-prep`) runs full pipeline from ASSESS. Midpoint (`/lecture-prep-edit`) is fully self-contained: loads CLAUDE.md config, typst-conventions, content inventory, tinymist skill. Explicit constraint loading Iron Law. Handles suspect inventories (re-extracts from PPTX/TM if inventory seems broken). |
| **Iteration strategy** | 10/10 | Midpoint: fix → re-check loop with max 3 iterations. Each fix category triggers re-check of dependent checks (coverage fix → overflow check). Fresh re-audit sub-agent after fixes (not self-review). Escalation to user after 3 iterations with remaining findings. Structural exit: mechanical checks decide completion, not honor system. |

**Architecture Total: 48/50**

### Enforcement Coverage

| # | Pattern | ASSESS | INDEX/SLIDES/NOTES/COMPILE | VERIFY | Midpoint Entry | Midpoint Fix Loop |
|---|---------|--------|---------------------------|--------|----------------|-------------------|
| 1 | Iron Laws | ➖ Light phase | ✅ Source fidelity + Sequential pipeline + Sub-agent delegation | ✅ Via reviewer | ✅ Constraint loading + Source-first + Diagnostic delegation + Evidence | ✅ Loop completion |
| 2 | Rationalization Tables | ➖ | ✅ 8 entries (entry skill) | ✅ Via check definitions | ✅ 11 entries (diagnosis) | ✅ Cascading fix awareness |
| 3 | Red Flags + STOP | ➖ | ✅ 6 entries (entry skill) | ➖ | ✅ 12 entries | ✅ |
| 4 | Gate Functions | ✅ 5-step | ✅ Per-phase (char count, overflow, alignment) | ✅ Issue → fix → recompile → re-verify | ✅ Context loaded gate + Diagnosis complete gate | ✅ All Checks Clean gate (mechanical) |
| 5 | Flowcharts as Spec | ✅ Pipeline overview with fix loops | ➖ Phase references not read | ➖ | ✅ Process overview | ✅ Fix priority flowchart |
| 6 | Staged Review Loops | ➖ | ➖ | ✅ 3 parallel reviewers | ✅ | ✅ Max 3 iterations |
| 7 | Delete & Restart | ➖ | ➖ | ➖ | ✅ "Tainted diagnosis = delete + re-run" | ✅ "Bad audit = fresh sub-agent" |
| 8 | Skill Dependencies | ✅ → INDEX | ✅ Chained through references | ✅ → UPLOAD | ✅ → Compile phase | ✅ → Compile + Verify |
| 9 | Honesty Framing | ➖ | ✅ "Training knowledge = fabricated facts" | ✅ | ✅ "No tool output = faked check", "Blanket dismissal = lying" | ✅ "All clean without output is lying" |
| 10 | Trigger-Only Descriptions | ✅ | ✅ | ✅ | ✅ | ✅ |
| 11 | No Pause Between Tasks | ✅ "Pausing is procrastination" | ✅ | ✅ | ✅ | ✅ (extensive) |
| 12 | Drive-Aligned Consequences | ✅ 4-drive table | ✅ In entry skill | ➖ | ✅ 5-drive table | ✅ |

### Critical Gaps

1. **Phase reference files not fully audited** — The entry skill delegates heavily to `references/phase-{index,slides,notes,compile,verify}.md` and `references/phase-{notes,slides}.md` (in skills/lecture-prep/references/). These weren't fully scored because they're loaded dynamically. The enforcement in those files may vary.

2. **VERIFY phase reviewer lacks drive-aligned consequences** — The reviewer agent and check definitions enforce structural independence well, but don't include rationalization tables or drive-aligned consequences for the reviewers themselves.

### Minor Recommendations

1. **Audit phase reference files** — Read and score `references/phase-{index,slides,notes,compile,verify}.md` against enforcement patterns. These are where most of the work happens.
2. **Add drive-aligned consequences to reviewer agent** — The reviewer dispatcher should include consequences for rubber-stamping checks.
3. **Add post-upload verification gate** — After Canvas upload, verify the files are accessible (not just that the upload command succeeded).
4. **ASSESS phase is enforcement-light** — While appropriate (it's a low-drift assessment phase), consider adding a rationalization table for skipping to later phases without proper assessment.

**Overall Score: 9.6/10**

---

## Cross-Workflow Comparison

| Dimension | Dev (9.8) | DS (9.0) | Writing (8.4) | Teaching (9.6) |
|-----------|-----------|----------|---------------|----------------|
| Architecture | 49/50 | 45/50 | 42/50 | 48/50 |
| Iron Laws | All phases | All phases | All phases | All phases |
| Rationalization Tables | Extensive (7-14 per phase) | Good (5-9 per phase) | Good (5-10 per phase) | Very good (8-12 per phase) |
| Gate Functions | Every phase, 5-step | Every phase, 5-step | Most phases, varying strength | Every phase, mechanical where possible |
| Independent Verification | Fresh subagents | Code execution checks | Lacks structural independence in sequential review | Strongest: dedicated reviewer agent + 3 sub-agents |
| Drive-Aligned Consequences | Full 5-drive tables | 2-drive shortcut tables | Mixed (1-5 drive tables) | Full 4-5 drive tables |
| Iteration Limits | Max 3 everywhere | Max 3 everywhere | Max 3 in revise, unlimited in outline/draft | Max 3 in fix loop |
| Flowcharts | Most phases | Some phases | Brainstorm only + revise loop | Entry + midpoint |

### Priority Improvements (Cross-Workflow)

1. **Writing: Add structural independence to sequential review** — Most impactful gap. Writing review sequential mode should mandate a fresh subagent.
2. **DS: Expand drive-aligned consequences** — Upgrade from 2-shortcut to 5-drive tables in implement and review.
3. **DS: Add flowchart to implement** — Visual spec for the task execution loop.
4. **Writing: Add flowcharts to middle phases** — Setup, outline, draft need visual specs.
5. **Teaching: Audit phase reference files** — Score the dynamically-loaded phase references.
6. **All: Standardize drive-aligned consequence format** — Some workflows use `|Shortcut|Consequence|` (2-col), others use `|Drive|Why|What|Failed|` (4-col). The 4-col format is more effective — standardize.
