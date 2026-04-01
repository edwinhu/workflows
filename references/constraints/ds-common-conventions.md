# DS Workflow: Common Conventions

Behavioral guidance for the DS skill family. Loaded ex-ante for prompt context, scored by LLM/human judgment during review.

**Skills that load this file:** ds (brainstorm), ds-fix (midpoint), ds-plan, ds-implement, ds-review, ds-verify, ds-delegate

After reading this index, load the specific convention files needed for your current phase.

---

## Index

| ID | Convention | File | Description |
|----|-----------|------|-------------|
| V1 | Assumption Over Evidence | [constraints/ds-assumption-over-evidence.md](constraints/ds-assumption-over-evidence.md) | Never treat assumptions as evidence — profile/verify fresh every time |
| V2 | Deferred Verification | [constraints/ds-deferred-verification.md](constraints/ds-deferred-verification.md) | Verify after EVERY step — "later" means never |
| V3 | Impatience Over Process | [constraints/ds-impatience-over-process.md](constraints/ds-impatience-over-process.md) | Follow process — speed without correctness is malpractice |
| V4 | Topic Change Protocol | [constraints/ds-topic-change-protocol.md](constraints/ds-topic-change-protocol.md) | Off-topic messages require announce-pause-handle-resume |
| V5 | DS Escape Patterns | [constraints/ds-escape-patterns.md](constraints/ds-escape-patterns.md) | Four observed escape patterns to watch for |
| V6 | Statistical Validity | [constraints/ds-statistical-validity.md](constraints/ds-statistical-validity.md) | Every statistical claim must have correct test |
| V7 | P-Hacking Prevention | [constraints/ds-p-hacking-prevention.md](constraints/ds-p-hacking-prevention.md) | Pre-register specifications, no post-hoc fishing |
| V8 | Sample Selection | [constraints/ds-sample-selection.md](constraints/ds-sample-selection.md) | Document and justify every sample filter |
| V9 | Deviation Rules (Analysis) | [constraints/ds-deviation-rules-analysis.md](constraints/ds-deviation-rules-analysis.md) | Analysis-specific deviation handling |

## Phase Loading Guide

| Phase | Must Load | Why |
|-------|-----------|-----|
| **ds (brainstorm)** | V1, V2, V3 | Brainstorm risks: assumptions, deferred checks, impatience |
| **ds-fix (midpoint)** | V1-V9 (all) | Midpoint can route to any phase |
| **ds-plan** | V1, V3 | Planning risks: assumptions, rushing past questions |
| **ds-implement** | V1, V2, V4, V5, V6, V7 | Implementation: verification, escape patterns, statistics |
| **ds-review** | V1, V2, V6, V7, V8 | Review: evidence-based, statistical validity |
| **ds-verify** | V1, V2 | Verification: fresh evidence, no deferred checks |
| **ds-delegate** | V5, V9 | Delegation: escape patterns, deviation handling |
