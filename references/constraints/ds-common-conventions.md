# DS Workflow: Common Conventions

Behavioral guidance for the DS skill family. Loaded ex-ante for prompt context, scored by LLM/human judgment during review.

**Skills that load this file:** ds (brainstorm), ds-fix (midpoint), ds-plan, ds-implement, ds-review, ds-verify, ds-delegate

After reading this index, load the specific convention files needed for your current phase.

---

## Index

| ID | Convention | File | Description |
|----|-----------|------|-------------|
| V1 | Assumption Over Evidence | [conventions/ds-assumption-over-evidence.md](conventions/ds-assumption-over-evidence.md) | Never treat assumptions as evidence — profile/verify fresh every time |
| V2 | Deferred Verification | [conventions/ds-deferred-verification.md](conventions/ds-deferred-verification.md) | Verify after EVERY step — "later" means never |
| V3 | Impatience Over Process | [conventions/ds-impatience-over-process.md](conventions/ds-impatience-over-process.md) | Follow process — speed without correctness is malpractice |
| V4 | Topic Change Protocol | [conventions/ds-topic-change-protocol.md](conventions/ds-topic-change-protocol.md) | Off-topic messages require announce-pause-handle-resume |
| V5 | DS Escape Patterns | [conventions/ds-escape-patterns.md](conventions/ds-escape-patterns.md) | Four observed escape patterns to watch for |
| V6 | Statistical Validity | [conventions/ds-statistical-validity.md](conventions/ds-statistical-validity.md) | Every statistical claim must have correct test |
| V7 | P-Hacking Prevention | [conventions/ds-p-hacking-prevention.md](conventions/ds-p-hacking-prevention.md) | Pre-register specifications, no post-hoc fishing |
| V8 | Sample Selection | [conventions/ds-sample-selection.md](conventions/ds-sample-selection.md) | Document and justify every sample filter |
| V9 | Deviation Rules (Analysis) | [conventions/ds-deviation-rules-analysis.md](conventions/ds-deviation-rules-analysis.md) | Analysis-specific deviation handling |

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
