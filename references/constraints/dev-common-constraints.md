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

## Verification

Run all constraint checks:

```bash
uv run python3 references/constraints/check-all.py .
```

Coverage: 6/6 dev constraints have `.py` check scripts = 100%.
