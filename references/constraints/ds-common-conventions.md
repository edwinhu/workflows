---
name: ds-common-conventions
description: Common judgment-based conventions index for the ds skill family
applies-to: [ds, ds-fix, ds-implement, ds-review, ds-delegate]
---

# DS Workflow: Common Conventions

Behavioral guidance for the DS skill family. Loaded ex-ante for prompt context and assessed by human or LLM judgment during review.

**Skills that load this file:** ds (orchestrator), ds-fix (midpoint), ds-implement, ds-review, ds-delegate.

After reading this index, load the specific convention files needed for your current role.

---

## Index

| ID | Convention | File | Description |
|----|-----------|------|-------------|
| V1 | Assumption Over Evidence | [constraints/ds-assumption-over-evidence.md](constraints/ds-assumption-over-evidence.md) | Never treat assumptions as evidence — profile/verify fresh every time |
| V2 | Deferred Verification | [constraints/ds-deferred-verification.md](constraints/ds-deferred-verification.md) | Verify after every technical step — "later" means never |
| V3 | Impatience Over Process | [constraints/ds-impatience-over-process.md](constraints/ds-impatience-over-process.md) | Follow process — speed without correctness is malpractice |
| V4 | Topic Change Protocol | [constraints/ds-topic-change-protocol.md](constraints/ds-topic-change-protocol.md) | Off-topic messages require announce-pause-handle-resume |
| V5 | DS Escape Patterns | [constraints/ds-escape-patterns.md](constraints/ds-escape-patterns.md) | Four observed escape patterns to watch for |
| V6 | Statistical Validity | [constraints/ds-statistical-validity.md](constraints/ds-statistical-validity.md) | Every statistical claim must have correct test |
| V7 | P-Hacking Prevention | [constraints/ds-p-hacking-prevention.md](constraints/ds-p-hacking-prevention.md) | Lock analysis choices in the approved PLAN; no post-hoc fishing |
| V8 | Sample Selection | [constraints/ds-sample-selection.md](constraints/ds-sample-selection.md) | Document and justify every sample filter |
| V9 | Deviation Rules (Analysis) | [constraints/ds-deviation-rules-analysis.md](constraints/ds-deviation-rules-analysis.md) | Analysis-specific deviation handling |

## Role Loading Guide

| Role | Must Load | Why |
|------|-----------|-----|
| **ds (orchestrator)** | V1, V2, V3 | Guard the approved PLAN against assumptions, deferred checks, and urgency shortcuts |
| **ds-fix (midpoint)** | V1-V9 (all) | Midpoint can route to any role |
| **ds-implement** | V1, V2, V4, V5, V6, V7 | Technical implementation and verification require evidence, statistics, and escape-pattern controls |
| **ds-review** | V4 | Human-feedback review needs the pause/resume protocol, not technical verification conventions |
| **ds-delegate** | V5, V9 | Delegation needs escape-pattern and deviation controls |
