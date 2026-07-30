# Workflow lifecycle architecture

The lifecycle layer separates enforcement mechanics from workflow-specific choices and execution
adapters. DS, writing, and workshop use exact native-plan approval identity; dev retains its current
SPEC/compiler path; `/work` remains lightweight and procedural.

## Before and after

| Concern | Before | After |
|---|---|---|
| Opening clarification | Domain-specific question rules | `clarify-before-recon-guard --workflow ds|dev|writing|workshop`; each profile supplies its sentinel and reconnaissance classifier |
| Approval persistence | DS-specific hook owned hashing and atomic writes | `approved-artifact.ts` owns byte hashing, strict metadata, atomic persistence for DS, writing, and workshop |
| Review evidence | Domain-specific approval markers | `reviewer-verdict-guard` uses one reviewer-owned current-hash YAML verdict across supported workflows |
| Implementation admission | Mixed status and artifact gates | `approved-artifact-gate` validates current hash, reviewer identity, and profile-specific chronology |
| Orchestrator mutation | Separate domain guards | `orchestrator-mutation-guard` and shared canonical path safety |
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

## Execution and review adapters

DS uses the shared sequential `beat-implement` runner. Writing and workshop authenticate the same
approved-plan identity and follow the same implementation/verifier doctrine, but retain controlled
parallel domain adapters:

```text
writing approved plan  → writing-draft section workflow → internal writing-review → /writing-revise
workshop approved plan → workshop-generate sections     → workshop-verify       → /workshop-revise
```

The domain generators are not plan interpreters: deterministic section/slide indexes provide their
work sets. Automated review is distinct from terminal human acceptance. Human feedback is recorded in
`.planning/HUMAN_REVIEW.md`; Markdown opens in Typora, DOCX in LibreOffice, and Typst/TeX in Neovim
with a current Tinymist or rendered preview.

Workshop has one canonical TypeScript Slide Spec parser at `hooks/_workshop_slide_table.ts`, exposed
through `scripts/workshop/workshop-slide-table.ts` for CLI consumers.
