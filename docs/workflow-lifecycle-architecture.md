# Workflow lifecycle architecture

The lifecycle layer separates enforcement mechanics from workflow-specific choices and execution
adapters. DS, writing, workshop, and workflow-creator use a hook-authenticated receipt selecting one generated
plan by `{planFile, planHash}`; dev retains its current legacy SPEC/compiler path; `/work` remains
lightweight and procedural.

## Before and after

| Concern | Before | After |
|---|---|---|
| Opening clarification | Domain-specific question rules | `clarify-before-recon-guard --workflow ds|dev|writing|workshop|workflow-creator`; each profile supplies its sentinel and reconnaissance classifier |
| Approval persistence | Domain-specific visible plan/metadata copies | `approved-artifact.ts` owns byte hashing and atomically binds one native generated plan in a hidden receipt for DS, writing, workshop, and workflow-creator |
| Review evidence | Domain-specific approval markers | `reviewer-verdict-guard` finalizes the receipt's reviewer-owned current-hash status without changing approval fields |
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
reference root. The agent deterministically loads common plus domain constraint files, then finalizes
the hook-owned receipt while preserving its approval fields. The receipt's `plan_file` and `plan_hash`
bind review to the exact current selected generated-plan bytes; the shared verdict guard permits no
other mutation.

## Execution and review adapters

A receipt-selected generated plan is immutable approved intent, not a progress ledger. `TaskList` is the
live execution authority and project auto-memory holds curated reusable facts across sessions. The hidden
receipt is hook-owned provenance only; user-facing review feedback belongs in the named human-review
surface, never in a second planning ledger.

DS and workflow-creator use the shared sequential `beat-implement` runner. Workflow-creator compiles the canonical approved-plan output manifest into exact task contracts before dispatch. Writing and workshop authenticate the same
approved-plan identity and follow the same implementation/verifier doctrine, but retain controlled
parallel domain adapters:

```text
writing approved plan  → writing-draft section workflow → internal writing-review → /writing-revise
workshop approved plan → workshop-generate sections     → workshop-verify       → /workshop-revise
workflow-creator plan  → TypeScript manifest compiler   → beat-implement        → wc-audit → /workflow-creator-improve
```

The domain generators are not plan interpreters: deterministic section/slide indexes provide their
work sets. Automated review is distinct from terminal human acceptance. Human feedback is recorded in
`.planning/HUMAN_REVIEW.md`; Markdown opens in Typora, DOCX in LibreOffice, and Typst/TeX in Neovim
with a current Tinymist or rendered preview.

Workshop has one canonical TypeScript Slide Spec parser at `hooks/_workshop_slide_table.ts`, exposed
through `scripts/workshop/workshop-slide-table.ts` for CLI consumers.
