# Workflow lifecycle architecture

The lifecycle layer separates enforcement mechanics from workflow-specific choices and execution
adapters. It protects a workflow transition without pretending DS and dev have the same plan format
or executor.

## Before and after

| Concern | Before | After |
|---|---|---|
| Opening clarification | DS-only no-exploration hook | `clarify-before-recon-guard --workflow ds|dev`; each profile supplies its sentinel and reconnaissance classifier |
| Approval persistence | DS-specific hook owned hashing and atomic writes | `approved-artifact.ts` owns byte hashing, strict metadata, atomic persistence; DS is its current producer |
| Review evidence | DS-only provenance guard; dev main chat made a marker | `reviewer-verdict-guard --workflow ds|dev`; both use a reviewer-owned current-hash YAML verdict |
| Implementation admission | DS runner parser and dev status-only marker gate | `approved-artifact-gate` validates current hash, reviewer identity, and profile-specific chronology |
| Orchestrator mutation | Separate DS and dev guards with duplicated path logic | `orchestrator-mutation-guard --workflow ds|dev` and shared canonical path safety |
| Task interchange | `beat-implement` internal shapes | `task-contract.ts` gives task/result identity a reusable seam |

## Shared mechanism, domain policy, execution adapter

`hooks/_workflow_policies.ts` is the policy boundary. A missing or unknown `--workflow` fails
closed. It supplies only domain choices: sentinel names, reconnaissance classification, reviewer
artifact, and mutation allowances. The shared libraries own canonical containment, symlink handling,
exact-byte SHA-256, UTC timestamps, strict metadata, strict verdict parsing, and chronology.

The clarification sentinel is deliberately small: it contains exactly `status: clarified` and the
current hook `sessionId`. It does not store requirements. Its only purpose is to prove that the
opening user response happened in this session before reconnaissance. A stale or malformed sentinel
cannot authorize reads. Fresh `/dev` uses `beat-clarify` for opening outcome/scope/constraint/done-
ness/evidence questions; `dev-clarify` remains post-recon clarification for ambiguities discovered
from the codebase.

Both adapters dispatch the generic `workflows:plan-checker` with an explicit domain and concrete
reference root. The agent deterministically loads common plus domain constraint files, then writes the
same four-field YAML frontmatter: `plan_hash`, `status`, `reviewer_session_id`, and `reviewed_at`.
The hash binds approval to the exact current `PLAN.md` bytes, and the shared verdict guard permits no
mutation other than that canonical verdict artifact.

## Execution boundary and next migration

DS currently persists its immutable native approved plan and passes a reviewed artifact to
`beat-implement`. Dev still uses SPEC + executable plan table + compiler-generated `.planning/run.js`.
That is intentional: this change does not introduce dev native-plan metadata, replace `dev_compile`,
or change R4/TDD/full-suite behavior.

The next seam is:

```text
dev executable plan parser → DATA task IR → generic sequential Workflow
DS native plan adapter      → DATA task IR → generic sequential Workflow
```

`task-contract.ts` is the DATA-IR identity seam. Dispatch remains sequential. The runner performs a
best-effort before/after filesystem-delta audit and validates observable changed files against each
task's writable paths, but this is not sandbox isolation; mutation parallelism waits for runtime-
enforceable worker isolation and merge semantics.
