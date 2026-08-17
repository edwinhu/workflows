---
name: ds-common-conventions
description: Common judgment-based conventions index for the ds workflow
applies-to: [ds]
---

# DS Workflow: Common Conventions

Behavioral guidance for the DS workflow. Loaded ex-ante for prompt context and assessed by human or LLM judgment during review.

After reading this index, load the specific convention files your task needs.

---

## Index

| ID | Convention | File | Description |
|----|-----------|------|-------------|
| V1 | Assumption Over Evidence | [ds-assumption-over-evidence.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-assumption-over-evidence.md) | Never treat assumptions as evidence — profile/verify fresh every time |
| V2 | Deferred Verification | [ds-deferred-verification.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-deferred-verification.md) | Verify after every technical step — "later" means never |
| V3 | Impatience Over Process | [ds-impatience-over-process.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-impatience-over-process.md) | Follow process — speed without correctness is malpractice |
| V4 | Topic Change Protocol | [ds-topic-change-protocol.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-topic-change-protocol.md) | Off-topic messages require announce-pause-handle-resume |
| V5 | DS Escape Patterns | [ds-escape-patterns.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-escape-patterns.md) | Four observed escape patterns to watch for |
| V6 | Statistical Validity | [ds-statistical-validity.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-statistical-validity.md) | Every statistical claim must have correct test |
| V7 | P-Hacking Prevention | [ds-p-hacking-prevention.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-p-hacking-prevention.md) | Lock analysis choices in the approved PLAN; no post-hoc fishing |
| V8 | Sample Selection | [ds-sample-selection.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-sample-selection.md) | Document and justify every sample filter |
| V9 | Deviation Rules (Analysis) | [ds-deviation-rules-analysis.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-deviation-rules-analysis.md) | Analysis-specific deviation handling |
