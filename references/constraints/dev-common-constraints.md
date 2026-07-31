---
name: dev-common-constraints
description: Common deterministic constraints index for the native-plan dev skill family
applies-to: [dev, dev-tdd, dev-implement, dev-review, dev-verify, dev-debug, dev-delegate, dev-design, dev-explore, dev-handoff, dev-test, dev-test-gaps, dev-plan-reviewer]
---

# Dev workflow: common constraints

Dev uses one native generated plan as immutable approved intent, the hidden hash-bound receipt as
approval/review provenance, `TaskList` as live work and finding state, returned phase results for
conversational status, and project paths for code and evidence. No fixed specification, plan,
compiler output, progress file, or visible phase ledger is authority.

## Index

| ID | Constraint | File | Check script | Role |
|---|---|---|---|---|
| C1 | Delegation Law | [delegation-law.md](delegation-law.md) | [delegation-law.py](delegation-law.py) | Main chat does not implement or investigate in place of the appropriate worker. |
| C1b | Verification vs Investigation | [verification-vs-investigation.md](verification-vs-investigation.md) | [verification-vs-investigation.py](verification-vs-investigation.py) | Test execution is verification; source reading is reconnaissance. |
| C2 | Real Test Enforcement | [real-test-enforcement.md](real-test-enforcement.md) | [real-test-enforcement.py](real-test-enforcement.py) | Tests exercise real production-relevant paths and protocol. |
| C3 | Structural vs Runtime Verification | [structural-vs-runtime-verification.md](structural-vs-runtime-verification.md) | [structural-vs-runtime-verification.py](structural-vs-runtime-verification.py) | Runtime evidence, not source presence, establishes behavior. |
| C4 | Deviation Rules | [dev-deviation-rules.md](dev-deviation-rules.md) | [dev-deviation-rules.py](dev-deviation-rules.py) | R1–R3 are recorded in TaskList; R4 requires user decision and native replan. |
| C5 | Requirement Traceability | [dev-requirement-traceability.md](dev-requirement-traceability.md) | [dev-requirement-traceability.py](dev-requirement-traceability.py) | `REQ-NN` plan requirements trace through `TASK-NN`, real tests, and fresh evidence. |

## Phase loading guide

| Phase | Must load | Purpose |
|---|---|---|
| Opening clarification / exploration / post-recon clarification | C2 context | Establish and discover the real-test contract without writing planning ledgers. |
| Native design and plan review | C2, C5 | Generate and independently validate `REQ-NN`/`TASK-NN`, RED/verify, evidence, and review-surface grammar. |
| Implement | C1, C1b, C2, C3, C4, C5 | Reconcile the current receipt-selected plan into TaskList, then execute RED-first work. |
| Test-gap audit, review, verify | C1b, C2, C3, C5 | Create TaskList findings for missing evidence and independently establish fresh coverage. |
| Debug | C1, C1b, C2, C3, C4 | Investigate and repair without reviving a mutable plan or visible ledger. |

## Lifecycle enforcement

- `clarify-before-recon-guard --workflow dev` admits reconnaissance only after the current-session
  `DEV_CLARIFIED.json` sentinel; the sentinel contains no requirements.
- Native `ExitPlanMode` persistence creates `.planning/.state/review.json` selecting the exact
  generated plan. `reviewer-verdict-guard --workflow dev` permits only its independent finalization.
- `approved-artifact-gate --workflow dev` admits implementation only for the current reviewed hash
  and distinct approval/review/implementation sessions.
- `orchestrator-mutation-guard --workflow dev` prevents reintroducing visible planning authority.

## Verification

```bash
uv run --with lxml python3 references/constraints/check-all.py .
```
