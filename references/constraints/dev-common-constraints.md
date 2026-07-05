---
name: dev-common-constraints
description: Common deterministic constraints index for the dev skill family
applies-to: [dev, dev-tdd, dev-implement, dev-review, dev-verify, dev-debug, dev-delegate, dev-design, dev-explore, dev-handoff, dev-test, dev-test-gaps, dev-spec-reviewer, dev-plan-reviewer]
---

# Dev Workflow: Common Constraints

Deterministic rules for the dev skill family. Each constraint can be verified by a co-located `.py` check script returning pass/fail. Self-contained files under `constraints/`.

**Skills that load this file:** dev (brainstorm), dev-tdd, dev-implement, dev-review, dev-verify, dev-debug

After reading this index, load the specific constraint files needed for your current phase.

---

## Index

| ID | Constraint | File | Check Script | Description |
|----|------------|------|-------------|-------------|
| C1 | Delegation Law | [delegation-law.md](delegation-law.md) | [delegation-law.py](delegation-law.py) | Main chat MUST NOT write code or investigate directly — delegate all to subagents |
| C1b | Verification vs Investigation | [verification-vs-investigation.md](verification-vs-investigation.md) | [verification-vs-investigation.py](verification-vs-investigation.py) | Running tests = verification; reading source = investigation. Not the same. |
| C2 | Real Test Enforcement | [real-test-enforcement.md](real-test-enforcement.md) | [real-test-enforcement.py](real-test-enforcement.py) | Tests must exercise real code paths — no mocks-only, no skips, same protocol as production |
| C3 | Structural vs Runtime Verification | [structural-vs-runtime-verification.md](structural-vs-runtime-verification.md) | [structural-vs-runtime-verification.py](structural-vs-runtime-verification.py) | Only runtime execution counts as verification — code existing in a file proves nothing |
| C4 | Deviation Rules | [dev-deviation-rules.md](dev-deviation-rules.md) | [dev-deviation-rules.py](dev-deviation-rules.py) | 4-rule system for unplanned discoveries — R1-R3 auto-fix, R4 STOP for architectural changes |
| C5 | Requirement Traceability | [dev-requirement-traceability.md](dev-requirement-traceability.md) | [dev-requirement-traceability.py](dev-requirement-traceability.py) | CATEGORY-NN IDs from SPEC.md must flow through PLAN.md, VALIDATION.md, and verification |

## Phase Loading Guide

Not every phase needs every constraint. Load by relevance:

| Phase | Must Load | Why |
|-------|-----------|-----|
| **Brainstorm** | — | No deterministic constraints at brainstorm stage |
| **Explore** | — | Read-only exploration, no implementation |
| **Clarify** | — | Clarification has no deterministic constraints |
| **Design** | C5 | Verify plan covers all SPEC requirement IDs, audit prose sections for un-ID'd requirements |
| **Implement** | C1, C1b, C2, C3, C4, C5 | All constraints: delegation, test reality, runtime evidence, deviation tracking, requirement tracing |
| **Review** | C1, C1b, C2, C3, C5 | Delegation boundary, test evidence gating, requirement coverage |
| **Verify** | C1b, C3, C5 | Verification boundary, runtime evidence, requirement tracing |
| **Debug** | C1, C1b, C2, C3, C4 | All constraints: fresh subagents, hypothesis testing, real tests, deviation tracking |

## Check Matrix

Which constraints are CRITICAL vs contextual in each phase:

| Check | Brainstorm | Explore | Clarify | Design | Implement | Review | Verify | Debug |
|-------|-----------|---------|---------|--------|-----------|--------|--------|-------|
| C1: Delegation | - | - | - | - | **CRITICAL** | - | - | **CRITICAL** |
| C1b: Verification vs Investigation | - | - | - | - | Post-subagent | Post-subagent | Post-subagent | **CRITICAL** |
| C2: Real Tests | Define | Discover infra | Verify strategy | Lock in plan | Enforce TDD | Gate evidence | Prove E2E | Regression |
| C3: Structural vs Runtime | - | - | - | - | Verify agent output | Gate test evidence | Fresh evidence | Verify fix |
| C4: Deviation Rules | - | - | - | - | **CRITICAL** | - | - | **CRITICAL** |
| C5: Requirement Traceability | - | - | - | Verify plan coverage | **CRITICAL** | Verify coverage | Trace to requirements | - |

**How to use this matrix:**
- **CRITICAL** = Primary enforcement point. Load the atomic constraint file and enforce fully.
- **Named context** = Constraint applies in this specific way for this phase.
- **-** = Constraint does not apply to this phase.

## Hook Coverage Matrix

Structural enforcement (Layer 2). Two PreToolUse guards are declared in skill frontmatter; one PostToolUse guard fires globally via `hooks/hooks.json`. Coverage is intentionally uneven — each gap is justified below.

| Skill | `dev-delegation-guard` (PreToolUse Write\|Edit) | `phase-gate-guard` (PreToolUse, artifact gate) | Gate artifact |
|-------|:---:|:---:|---|
| dev (brainstorm) | ✅ | ➖ | — (entry phase; no upstream gate). Writes `SPEC_REVIEWED.md` (status: APPROVED) on spec-review pass. |
| dev-explore | ➖ | ✅ | `.planning/SPEC_REVIEWED.md` (status: APPROVED) |
| dev-clarify | ➖ | ✅ | `.planning/SPEC_REVIEWED.md` (status: APPROVED) |
| dev-design | ➖ | ✅ | `.planning/SPEC_REVIEWED.md` (status: APPROVED) |
| dev-implement | ✅ | ✅ | `.planning/PLAN_REVIEWED.md` (status: APPROVED) |
| dev-test-gaps | ✅ | ➖ | — (intra-implement; no phase gate) |
| dev-review | ✅ | ✅ | `.planning/VALIDATION.md` (status: validated) |
| dev-verify | ✅ | ✅ | `.planning/REVIEW_STATE.md` (status: APPROVED) |
| dev-debug | ✅ | ➖ | — (midpoint re-entry; no linear upstream gate) |
| dev-handoff | ✅ | ➖ | — (pause/resume; no phase gate) |
| dev-delegate, dev-tdd, dev-test*, dev-tools, dev-worktree | ➖ | ➖ | run inside Task agents / are reference skills (see below) |
| dev-spec-reviewer, dev-plan-reviewer | ➖ | ➖ | dispatched AS read-only subagents (`allowed-tools`); restriction is at dispatch |

**Global (all skills, via `hooks/hooks.json`):** `atomic-constraint-guard.py` (PostToolUse Edit/Write — non-blocking monolith-constraint guard), plus `lint-check`, `image-read-guard`, `pattern-scan`, session hooks. These do not need per-skill declaration.

**Justified gaps (intentional, not drift):**
- **`phase-gate-guard` only on artifact-consuming phases.** explore/clarify/design gate on the upstream `SPEC.md`; implement on `PLAN_REVIEWED.md`; review on `VALIDATION.md`; verify on `REVIEW_STATE.md`. Brainstorm/debug/handoff have no linear upstream artifact to gate, so they declare no phase gate.
- **`dev-delegation-guard` only on main-chat orchestration phases** (dev, implement, test-gaps, review, verify, debug, handoff) where main chat must delegate code-writing to subagents. explore/clarify/design are read-only or `.planning/`-writing planning phases — main chat legitimately writes SPEC.md/PLAN.md there (the guard allows `.planning/` writes), so the guard is unnecessary.
- **Reviewer/tool/test sub-skills declare no hooks** because they execute inside dispatched Task agents (whose tools are restricted at dispatch via `allowed-tools`) or are reference skills, not main-chat orchestration phases. The enforcing hook fires in the parent orchestrating skill.

**Maintenance rule:** when adding a new dev phase that orchestrates code-writing, add `dev-delegation-guard`. When it consumes an upstream artifact, add `phase-gate-guard` with the correct `GATE_ARTIFACT`, `GATE_STATUS`, **and `GATE_BLOCKED_TOOLS`**. Update this matrix in the same edit.

> **Load-bearing detail — `GATE_BLOCKED_TOOLS` is mandatory.** `phase-gate-guard.py` defaults `blocked_tools={Write,Edit}` and `exit(0)`s for any tool not in that set. A phase whose first action is `Agent` (subagent dispatch) MUST set `GATE_BLOCKED_TOOLS=Agent` (dev-explore, which also greps/globs, sets `Grep,Glob,Agent`) or the hook fires on the `Agent` call, finds it un-blocked, and silently allows it — the gate becomes a no-op. Verify every gate with: `echo '{"tool_name":"Agent","tool_input":{}}' | GATE_ARTIFACT=.planning/MISSING.md GATE_BLOCKED_TOOLS=Agent uv run python3 hooks/phase-gate-guard.py` → must emit a `deny`.

## Verification

Run all constraint checks:

```bash
uv run --with lxml python3 references/constraints/check-all.py .
```

Coverage: 6/6 dev constraints have `.py` check scripts = 100%.
