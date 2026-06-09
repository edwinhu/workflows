---
name: claim-id-traceability
description: CLAIM-XX IDs from PRECIS.md must flow through every downstream artifact
applies-to: [writing-setup, writing-outline, writing-draft, writing-validate, writing-review, writing-revise, writing-precis-reviewer, writing-outline-reviewer]
---

## Rule

PRECIS.md assigns unique IDs to every claim (CLAIM-01, CLAIM-02, etc.). These IDs flow through the entire workflow:

| Artifact | How IDs appear |
|----------|---------------|
| **PRECIS.md** | `CLAIM-01: [claim text]` -- unique ID per claim |
| **OUTLINE.md** | `Implements: [CLAIM-01, CLAIM-02]` per section |
| **outlines/*.md** | `Claim Supported: CLAIM-01` per section outline |
| **VALIDATION.md** | `CLAIM-01: COVERED / PARTIAL / MISSING` -- full coverage map |
| **REVIEW.md** | Issues reference claim IDs when relevant |

**Without IDs, "we covered the argument" is vague. With IDs, you can verify that CLAIM-01, CLAIM-02, and CLAIM-03 are each addressed with evidence in specific sections.**

## Rationale

**Why this exists** -- in early writing workflows, "the argument is covered" was asserted without proof. Validation would pass because the agent believed it had addressed the claims, but actual sections were missing key arguments. Claim IDs make coverage auditable: VALIDATION.md can mechanically check that every CLAIM-XX appears in at least one section outline and draft. Vague coverage assertions become concrete traceable links.

## Examples

### Correct

```markdown
# PRECIS.md
CLAIM-01: Securities regulation imposes excessive compliance costs on small issuers
CLAIM-02: The materiality standard is applied inconsistently across circuits
CLAIM-03: Disclosure overload reduces investor decision quality

# OUTLINE.md
## Part I: The Cost Problem
Implements: [CLAIM-01]

## Part II: Materiality Divergence
Implements: [CLAIM-02]

## Part III: Information Overload
Implements: [CLAIM-03, CLAIM-01]

# VALIDATION.md
CLAIM-01: COVERED (Part I, Part III)
CLAIM-02: COVERED (Part II)
CLAIM-03: COVERED (Part III)
```

### Incorrect

```markdown
# PRECIS.md
This paper argues that securities regulation is costly, materiality is inconsistent,
and disclosure causes overload.
(No CLAIM IDs. Claims are embedded in prose. Can't trace or validate.)

# OUTLINE.md
## Part I: The Cost Problem
(No "Implements" line. No way to verify which claims this section covers.)

# VALIDATION.md
"All claims are addressed."
(No per-claim status. No evidence. Just assertion.)
```

## Traceability Facts

- Validation checks traceability — it cannot add it. The IDs must exist before validation runs, so "I'll add traceability during validation" schedules work the phase cannot do; assign IDs as each artifact is created.
- A claim with no section home is a structural gap, not an ID inconvenience — flag it as an R4 deviation; the outline structure needs revision.
- "The claims are obvious from context" is obvious only to you, now — not to the validation phase or a resuming session. Asserting coverage without per-claim IDs is an unverified claim presented as fact.

## Red Flags

- **PRECIS.md has claims without CLAIM-XX IDs** -- STOP. Every claim needs a unique, traceable identifier.
- **OUTLINE.md sections missing `Implements:` lines** -- STOP. Every section must declare which claims it covers.
- **VALIDATION.md says "all claims covered" without per-claim status** -- STOP. Validate each CLAIM-XX individually.
- **A CLAIM-XX appears in PRECIS.md but not in any outline section** -- STOP. That's a structural gap. Flag it.
- **Adding new claims mid-workflow without updating PRECIS.md** -- STOP. New claims need IDs and must flow through all downstream artifacts.
