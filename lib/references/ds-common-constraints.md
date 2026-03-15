# DS Workflow: Common Constraints

Shared enforcement for all ds-family skills. Every ds skill that touches data, implementation, review, or verification MUST Read() this file.

**Skills that load this file:** ds (brainstorm), ds-fix (midpoint), ds-plan, ds-implement, ds-review, ds-verify, ds-delegate

---

## C1: Assumption Over Evidence

The most common failure across ALL ds phases: treating your assumptions as evidence.

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "I already know what this data looks like" | Your knowledge is stale or wrong. Data changes, schemas drift, nulls appear. | Profile/verify fresh every time |
| "Results look roughly right" | "Roughly" means you didn't check. Roughly right is precisely wrong. | Compare against specific expected values from SPEC.md or PLAN.md |
| "I can see the issue from the output" | You see a symptom, not a cause. Pattern-matching from output is not diagnosis. | Trace backwards to the first divergence point |
| "It should reproduce / be the same" | "Should" is not evidence. Run it and compare. | Execute fresh, hash outputs, compare |
| "I trust the analyst / prior step" | Trust is not verification. Claims require evidence. | Run independent checks yourself |

**Drive-Aligned Framing:** Every time you substitute assumption for evidence, you choose YOUR confidence over the USER's correctness. The user doesn't experience your certainty — they experience your errors.

---

## C2: Deferred Verification

The second most common failure: planning to verify "later" (which means never).

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "I'll check at the end" | Errors compound silently. By the end, the root cause is buried under 10 transformations. | Verify after EVERY step |
| "I'll fix it and check later" | Later never comes. Your unverified fix is a guess. | Fix AND verify in the same step |
| "I just ran it" | Your prior run is not a current verification. Code, data, or environment may have changed. | Run it again NOW |
| "I'll combine these steps to save time" | Combined steps hide which one failed. Your efficiency creates undiagnosable bugs. | One operation per verification cycle |

**Drive-Aligned Framing:** Deferred verification is not efficiency — it's debt. The user pays for your deferred check with hours of debugging when the silent error surfaces downstream.

---

## C3: Impatience Over Process

The third common failure: skipping process steps because "the user is waiting."

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "User seems impatient, skip to analysis" | Wrong results from skipped process waste MORE time than 3 questions or 30 seconds of verification | Follow the process. Speed without correctness is malpractice. |
| "This will slow us down" | A 30-second check saves hours of rework. A 10-minute interview prevents weeks of wrong analysis. | Run the check / ask the question |
| "The request is clear enough" | Clear to YOU is not clear to the USER. Your assumptions ≠ their intent. | Confirm with AskUserQuestion |
| "I'll optimize later if it's slow" | Later never comes. The pipeline runs once and everyone moves on. | Design correctly NOW |

**Drive-Aligned Framing:** You skip steps because you think speed is helpful. The user doesn't experience your speed — they experience your results. Fast wrong results are slower than slow correct ones.

---

## C4: Data Quality Checks

**Canonical reference:** `lib/skills/ds-implement/references/ds-checks.md`

All skills that evaluate data quality (ds-review, ds-fix, ds-verify) MUST Read() the canonical checks file to ensure identical DQ1-DQ6, M1, R1 definitions. Do not inline check definitions — they will drift.

---

## How to Use

Each ds-family skill should Read() this file at the start of its process. Phase-specific enforcement (Iron Laws, phase-specific rationalizations) remains in each skill's SKILL.md. This file provides the shared baseline that prevents cross-skill drift.

```bash
# From any skill — discover via plugin cache:
command ls -d ~/.claude/plugins/cache/edwinhu-plugins/workflows/*/lib/references/ds-common-constraints.md 2>/dev/null | sort -V | tail -1
# Then Read() the output path
```
