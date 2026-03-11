# Superpowers Adoption Recommendations for workflows:dev

> Compared superpowers v5.0.0 (2026-03-10 pull) with workflows:dev v4.17.0

## Executive Summary

Superpowers excels at **design-phase tooling** (visual brainstorming, document review subagents, two-stage code review). Workflows:dev excels at **execution discipline** (real test enforcement, phase gates, delegation enforcement, ralph loop recovery). The biggest wins come from adopting superpowers' design-phase patterns into workflows' existing structure.

## Comparative Matrix

| Feature | Superpowers | Workflows:Dev | Winner | Priority |
|---------|------------|---------------|--------|----------|
| Visual Brainstorming | Complete | None | **Superpowers** | Medium |
| Spec/Plan Review Subagents | Explicit templates | None | **Superpowers** | **High** |
| Two-Stage Code Review | Spec + Quality split | Combined review | **Superpowers** | **High** |
| Plan Chunking | ≤1000-line chunks | Linear PLAN.md | **Superpowers** | Medium |
| Feature Decomposition | None | Phase 4 gate | **Workflows** | — |
| Real/Fake Test Enforcement | Basic TDD | Comprehensive | **Workflows** | — |
| Sequential Phase Gates | Manual invocation | Auto-chained | **Workflows** | — |
| Parallel Exploration | Discussed | Formalized | **Workflows** | — |
| Ralph Loop + Recovery | None | Explicit | **Workflows** | — |
| 5-Step Verification Gate | 4-step | IDENTIFY-RUN-READ-VERIFY-CLAIM | **Workflows** | — |

---

## HIGH PRIORITY — Adopt These

### 1. Spec Document Review Subagent (after Phase 1)

**Gap:** Workflows writes SPEC.md and immediately proceeds to explore. No one reviews the spec for completeness, contradictions, or missing edge cases.

**Superpowers pattern:** Dedicated reviewer subagent with structured checklist:
- Completeness (all requirements covered?)
- Consistency (contradictions between sections?)
- Clarity (ambiguous language?)
- YAGNI (unnecessary complexity?)
- Scope (too broad? too narrow?)
- Architecture (mentions approach too early?)

**Adoption:** Add a `dev-spec-reviewer` subagent prompt. After Phase 1 writes SPEC.md, dispatch reviewer before Phase 2. Fix-and-re-review loop (max 5 iterations).

**Where it fits:**
```
Phase 1 (brainstorm) → SPEC.md written
                     → [NEW] Spec reviewer subagent dispatched
                     → Issues found? Fix → re-review
                     → Approved → Phase 2 (explore)
```

**Concrete benefit:** Catches "missing: what happens when X fails?" before 3 phases of exploration and design build on a flawed spec.

---

### 2. Plan Document Review Subagent (after Phase 4)

**Gap:** Workflows writes PLAN.md and immediately begins implementation. No review of task decomposition, file structure, or task ordering.

**Superpowers pattern:** Plan reviewer checks:
- Task completeness (do tasks cover all spec requirements?)
- Task granularity (are tasks small enough for single subagent?)
- File structure (are files logically organized?)
- Task ordering (do dependencies flow correctly?)
- Checkbox syntax (are tasks formatted for agentic tracking?)

**Adoption:** Add a `dev-plan-reviewer` subagent prompt. After Phase 4 writes PLAN.md, dispatch reviewer before Phase 5. Same fix-and-re-review loop.

**Where it fits:**
```
Phase 4 (design) → PLAN.md written
                 → [NEW] Plan reviewer subagent dispatched
                 → Issues found? Fix → re-review
                 → Approved → Phase 5 (implement)
```

**Concrete benefit:** Catches "Task 3 is too large—split into file creation + logic + tests" before implementation subagents struggle with 500-line tasks.

---

### 3. Two-Stage Code Review (Phase 6)

**Gap:** Workflows:dev-review runs a single combined review. This conflates "did we build the right thing?" with "did we build it well?"—leading to confused feedback.

**Superpowers pattern:** Two sequential stages:
1. **Spec Compliance Review** — Does the code match SPEC.md exactly? Uses same protocol? Implements all requirements?
2. **Code Quality Review** — Only runs after spec compliance passes. Checks: readability, performance, error handling, naming.

**Why separation matters:**
- If code uses HTTP but spec says WebSocket, quality review is wasted effort
- Implementer gets clear signal: "wrong approach" vs "right approach, needs polish"
- Spec compliance fails fast; quality review can be thorough

**Adoption:** Split `dev-review` into two dispatched subagents:
```
Phase 6:
  Stage 1: Spec compliance reviewer
    → FAIL: back to implementer (fix approach)
    → PASS: proceed to Stage 2
  Stage 2: Code quality reviewer
    → FAIL: back to implementer (polish code)
    → PASS: proceed to Phase 7 (verify)
```

**Concrete benefit:** Eliminates the "I fixed the style issues but the whole approach is wrong" antipattern.

---

## MEDIUM PRIORITY — Adopt When Ready

### 4. Visual Companion for Brainstorming

**Gap:** Workflows handles all brainstorming in text. UI/layout decisions described verbally—slow and error-prone.

**Superpowers pattern:**
- Local Express server renders HTML mockups in browser
- Per-question decision: "Does this need visual comparison?"
- Semantic file naming: `layout-v1.html`, `toggle-options-v2.html`
- User interactions tracked to `.events` JSON file
- Click/hover patterns analyzed for hesitation

**Adoption approach:**
- Add to Phase 1 (brainstorm) or Phase 4 (design) when UI decisions arise
- Use `browser-automation` skill to render comparisons
- Optional—only for features with visual components

**Where it fits:**
```
Phase 1 or Phase 4:
  Question involves visual decision?
    YES → Render options in browser, collect user selection
    NO  → Text-based question (existing pattern)
```

**Dependency:** Requires browser automation infrastructure (already available via `mcp__chrome-devtools__*`).

---

### 5. Plan Chunking for Large Features

**Gap:** Workflows writes a single PLAN.md. For large features (20+ tasks), the plan itself becomes unwieldy and hard to review.

**Superpowers pattern:**
- Plans broken into chunks (≤1000 lines, logically self-contained)
- Each chunk reviewed separately before proceeding
- Chunks have clear boundaries: "infrastructure → core logic → tests → integration"

**Adoption approach:**
- Add to Phase 4 (design): If PLAN.md > 15 tasks, break into ordered chunks
- Each chunk gets plan-reviewer dispatch
- Implementation proceeds chunk-by-chunk

**Where it fits:**
```
Phase 4 (design):
  tasks > 15?
    YES → Break into chunks, review each
    NO  → Single PLAN.md (existing pattern)
```

---

### 6. Model Selection Guidance for Subagents

**Gap:** Workflows delegates to subagents but doesn't specify which model tier to use.

**Superpowers pattern:**
- **Cheap model** (Haiku): Mechanical tasks—file creation, boilerplate, formatting
- **Standard model** (Sonnet): Integration work, moderate complexity
- **Capable model** (Opus): Architecture decisions, complex debugging

**Adoption approach:** Add model tier hints to `dev-delegate` when dispatching implementation subagents. Not enforced (Claude Code doesn't support model routing yet), but documents intent for when it does.

---

## NOT RECOMMENDED — Workflows Already Better

| Superpowers Feature | Why Not Adopt |
|---|---|
| Manual skill invocation | Workflows' auto-chaining between phases is superior |
| Basic TDD enforcement | Workflows' REAL test enforcement with protocol matching is more comprehensive |
| 4-step verification | Workflows' 5-step IDENTIFY-RUN-READ-VERIFY-CLAIM is more robust |
| Implicit iteration limits | Workflows' ralph loop with explicit 3-failure recovery is clearer |

---

## Implementation Roadmap

### Phase A: Document Review (High Impact, Low Effort)
1. Write `lib/skills/dev-spec-reviewer/SKILL.md` — reviewer prompt template
2. Write `lib/skills/dev-plan-reviewer/SKILL.md` — reviewer prompt template
3. Update `skills/dev/SKILL.md` Phase 1 exit gate to dispatch spec reviewer
4. Update `lib/skills/dev-design/SKILL.md` Phase 4 exit gate to dispatch plan reviewer
5. Test with 2-3 real features

### Phase B: Two-Stage Review (High Impact, Medium Effort)
1. Split `lib/skills/dev-review/SKILL.md` into spec-compliance + code-quality stages
2. Create reviewer prompt templates for each stage
3. Update review dispatch logic
4. Test with real PRs

### Phase C: Visual + Chunking (Medium Impact, Higher Effort)
1. Add visual companion option to brainstorm/design phases
2. Add plan chunking logic for large features
3. Add model tier hints to delegation

---

## Key Insight

**Superpowers is better at catching problems in documents (specs, plans) before implementation starts.** Workflows is better at catching problems during and after implementation. Adopting superpowers' document review patterns would close workflows' biggest gap: bad specs and bad plans that survive into implementation.

The ideal flow: **Superpowers-quality planning → Workflows-quality execution.**
