# Audit-Fix Loop Enforcement Audit
## Ralph Loop Iteration 1

**Date:** 2026-03-09
**Auditor:** Claude Sonnet 4.5
**Scope:** dev, ds, writing workflow families
**Reference:** lecture-prep-edit skill (course-materials plugin)

---

## Executive Summary

**Current State:** All three workflow families (dev, ds, writing) have review and verification phases but **LACK explicit audit-fix loops**. They have one-shot review → fix → done patterns instead of diagnose → fix → re-check → loop → all-clean.

**Target:** Implement audit-fix loops matching lecture-prep-edit pattern in all workflow families to achieve 9.5/10 quality score.

**Critical Gap:** When review finds issues, workflows say "return to implement phase" but don't enforce re-review after fixes. This allows claiming "fixed" without verification.

---

## Reference Pattern: lecture-prep-edit

### What Makes It Work

The lecture-prep-edit skill demonstrates the ideal audit-fix loop:

```
Step 2: Diagnose and Route
  ├─ Identify specific issue type
  ├─ Route to appropriate fix procedure
  └─ Fix the issue

Step 3: Verify and Resume
  ├─ After ANY fix: Read("references/phase-compile.md")
  ├─ Compile → VERIFY (reviewer) → UPLOAD
  └─ Loop back if issues remain

Gate: Fix Complete
  1. IDENTIFY: What artifact proves the fix worked?
  2. RUN: Recompile + re-review
  3. READ: Check compilation output and reviewer report
  4. VERIFY: PDFs exist + reviewer reports clean
  5. CLAIM: Only then report fix to user
```

**Key enforcement:**
- **Iron Law**: "Claiming 'fixed' without recompiling and re-verifying is LYING"
- **Mandatory re-review**: After any fix, you MUST re-enter verification pipeline
- **Gate function**: 5-step verification before claiming completion
- **No escape hatch**: Cannot skip re-review even for "small fixes"

---

## Audit Results by Workflow Family

### 1. Dev Workflow

**Files Audited:**
- `skills/dev/SKILL.md` (Phase 1: brainstorm)
- `lib/skills/dev-review/SKILL.md` (Phase 6)
- `lib/skills/dev-verify/SKILL.md` (Phase 7)
- `lib/skills/dev-implement/SKILL.md` (Phase 5)

**Current Flow:**
```
dev-implement → dev-review → APPROVED? → dev-verify → complete
                    ↓
              CHANGES REQUIRED
                    ↓
          "Return to /dev-implement"
                    ↓
                 [LOOP MISSING HERE]
```

#### Enforcement Patterns Present

| Pattern | dev-review | dev-verify | Score |
|---------|------------|------------|-------|
| Iron Laws | ✅ Test evidence mandatory | ✅ Fresh verification | Strong |
| Rationalization Tables | ✅ 8 entries | ✅ 11 entries | Strong |
| Red Flags | ✅ 6 flags | ✅ 7 flags | Strong |
| Gate Functions | ⚠️ Weak | ✅ 5-step gate | Medium |
| Honesty Framing | ✅ "LYING" language | ✅ "LYING" language | Strong |
| Drive-Aligned Consequences | ✅ Present | ✅ Present | Strong |
| **Staged Review Loops** | **❌ MISSING** | **❌ MISSING** | **CRITICAL GAP** |

#### Specific Gaps

1. **No iteration counter**: dev-review can return CHANGES REQUIRED indefinitely
2. **No mandatory re-review**: Says "return to /dev-implement" but doesn't enforce re-review after fixes
3. **No exit criteria**: Doesn't specify when to escalate vs. when to approve despite issues
4. **No "max iterations" logic**: Could loop forever

**Current Score: 6.5/10** (strong enforcement, missing audit-fix loop)

---

### 2. DS Workflow

**Files Audited:**
- `skills/ds/SKILL.md` (Phase 1: brainstorm)
- `lib/skills/ds-review/SKILL.md` (Phase 4)
- `lib/skills/ds-verify/SKILL.md` (Phase 5)

**Current Flow:**
```
ds-implement → ds-review → APPROVED? → ds-verify → complete
                   ↓
            CHANGES REQUIRED
                   ↓
         "Return to /ds-implement"
                   ↓
                [LOOP MISSING HERE]
```

#### Enforcement Patterns Present

| Pattern | ds-review | ds-verify | Score |
|---------|-----------|-----------|-------|
| Iron Laws | ⚠️ Weak | ✅ Fresh re-run | Medium |
| Rationalization Tables | ✅ 5 entries | ✅ 5 entries | Medium |
| Red Flags | ✅ 5 flags | ✅ 5 flags | Medium |
| Gate Functions | ⚠️ Weak | ✅ 5-step gate | Medium |
| Honesty Framing | ❌ Missing | ⚠️ Weak | Weak |
| Drive-Aligned Consequences | ✅ Present | ✅ Present | Strong |
| **Staged Review Loops** | **❌ MISSING** | **❌ MISSING** | **CRITICAL GAP** |

#### Specific Gaps

1. **No iteration limit**: ds-review says "max 3 cycles" in workflow diagram but doesn't enforce it
2. **No re-review enforcement**: After fixes, doesn't mandate fresh review
3. **Weak honesty framing**: Doesn't use "LYING" language in ds-review
4. **No reconciliation after fixes**: Parallel review mode has reconciliation, but sequential doesn't

**Current Score: 5.5/10** (weaker enforcement than dev, missing audit-fix loop)

---

### 3. Writing Workflow

**Files Audited:**
- `skills/writing/SKILL.md` (Phase 1: brainstorm)
- `skills/writing-review/SKILL.md`
- `skills/writing-revise/SKILL.md`

**Current Flow:**
```
writing-draft → writing-review → REVIEW.md created
                                      ↓
                              writing-revise
                                      ↓
                          "Generate report" → complete
                                      ↓
                              [LOOP MISSING HERE]
```

#### Enforcement Patterns Present

| Pattern | writing-review | writing-revise | Score |
|---------|----------------|----------------|-------|
| Iron Laws | ✅ Reading required | ✅ Critique over comfort | Strong |
| Rationalization Tables | ✅ 11 entries | ✅ 10 entries | Strong |
| Red Flags | ✅ 7 flags | ✅ 5 flags | Strong |
| Gate Functions | ⚠️ Weak | ❌ Missing | Weak |
| Honesty Framing | ✅ "LYING" language | ⚠️ "LYING" language | Medium |
| Drive-Aligned Consequences | ❌ Missing | ✅ Present | Weak |
| **Staged Review Loops** | **❌ MISSING** | **❌ MISSING** | **CRITICAL GAP** |

#### Specific Gaps

1. **No re-review after revise**: writing-revise says "Generate report" and exits - no re-review!
2. **No iteration limit**: Could revise indefinitely without converging
3. **No verification gate**: writing-revise doesn't verify all issues were resolved
4. **No "all clean" criteria**: Doesn't define when revisions are complete

**Current Score: 6.0/10** (strong rationalization prevention, missing audit-fix loop)

---

## Cross-Workflow Patterns

### What All Three Are Missing

| Missing Element | Impact | Severity |
|----------------|--------|----------|
| **Explicit loop back to review** | Allows claiming "fixed" without verification | CRITICAL |
| **Iteration counter** | Can loop indefinitely, wasting time | HIGH |
| **Exit criteria** | No clear "all clean" vs. "escalate" decision | HIGH |
| **Re-review honesty framing** | Can skip re-review without feeling dishonest | MEDIUM |
| **Loop-specific rationalization table** | "I fixed it, no need to re-check" goes unchallenged | MEDIUM |

### What lecture-prep-edit Has That They Don't

1. **Step 3: Verify and Resume** - Explicit "after any fix, re-enter pipeline" instruction
2. **Gate: Fix Complete** - 5-step verification before claiming done
3. **No escape language** - Doesn't say "return to implement", says "re-run COMPILE → VERIFY"
4. **Honesty reframe** - "Claiming fixed without re-verifying is LYING"

---

## Recommended Fixes

### Pattern to Add: Staged Review Loops (Pattern #6)

From enforcement-checklist.md:

```markdown
## Review Loop

1. Complete work unit
2. Self-review against [criteria]
3. If issues found:
   a. Fix issues
   b. Re-review (max [N] iterations)
   c. If still failing after [N], escalate to user
4. If clean, proceed
```

### Implementation Plan

For each workflow family, add to the review phase:

1. **After review returns issues:**
   ```markdown
   ### Audit-Fix Loop (Max 3 Iterations)

   When review finds issues:

   1. Document issues in REVIEW.md
   2. Apply fixes (via implement/revise phase)
   3. **MANDATORY: Re-run review (same criteria)**
   4. If still has issues AND iteration < 3:
      - Repeat loop
   5. If still has issues AND iteration >= 3:
      - Escalate to user with remaining issues
   6. If all clean: Proceed to next phase

   **Claiming "fixed" without re-review is LYING.**
   ```

2. **Add iteration tracking:**
   ```markdown
   Create .claude/REVIEW_ITERATIONS.md:

   ```yaml
   iteration: 1
   max_iterations: 3
   issues_remaining: 5
   ```

3. **Add honesty framing:**
   ```markdown
   <EXTREMELY-IMPORTANT>
   ## The Iron Law of Re-Review

   **NO "FIXED" CLAIMS WITHOUT RE-REVIEW. This is not negotiable.**

   After applying fixes from REVIEW.md, you MUST:
   1. Re-run the review (same criteria, fresh eyes)
   2. Verify issues are actually resolved
   3. Check for new issues introduced by fixes
   4. Only THEN claim fixes are complete

   "I fixed it" without re-checking is LYING about fix quality.
   </EXTREMELY-IMPORTANT>
   ```

4. **Add exit gate:**
   ```markdown
   ### Gate: Exit Review Loop

   Before claiming workflow complete:

   1. IDENTIFY: What proves all issues are resolved?
   2. RUN: Fresh review pass
   3. READ: Check review output
   4. VERIFY: Zero issues >= 80 confidence
   5. CLAIM: Only if steps 1-4 pass OR max iterations reached
   ```

---

## Scoring Methodology

**Total points: 10.0**

| Category | Points | Criteria |
|----------|--------|----------|
| Iron Laws | 1.5 | Strong absolute constraints |
| Rationalization Tables | 1.5 | Preempts shortcuts |
| Red Flags | 1.0 | Pattern interrupts |
| Gate Functions | 1.5 | Programmatic verification |
| Honesty Framing | 1.5 | Recruits honesty drive |
| Drive-Aligned Consequences | 1.0 | Targets correct drive |
| **Staged Review Loops** | **2.0** | **Audit-fix iteration** |
| Other patterns | 1.0 | Flowcharts, trigger-only, etc. |

**Current Scores:**
- dev: 6.5/10 (missing 2.0 for review loops, 0.5 for weak gates, 1.0 for partial other patterns)
- ds: 5.5/10 (missing 2.0 for review loops, 1.0 for weak honesty, 1.5 for weak gates)
- writing: 6.0/10 (missing 2.0 for review loops, 1.0 for weak gates, 1.0 for missing drive-aligned in review)

---

## Next Steps

1. **Use /workflow-creator Mode 3** to improve each workflow family:
   - Add "Staged Review Loops" section to review phases
   - Add iteration tracking mechanism
   - Add re-review honesty framing
   - Add exit gates with clear criteria

2. **Priority order** (highest impact first):
   - dev workflow (most used, highest stakes)
   - ds workflow (reproducibility critical)
   - writing workflow (quality iteration most valuable)

3. **Validation:**
   - Re-audit after improvements
   - Score each workflow
   - Target: 9.5/10 (only missing points on optional patterns)

---

## Completion Criteria

**ALL_WORKFLOWS_AUDIT_LOOPS_9_5** is TRUE when:

- [ ] dev workflow has explicit audit-fix loop with max 3 iterations
- [ ] ds workflow has explicit audit-fix loop with max 3 iterations
- [ ] writing workflow has explicit audit-fix loop with max 3 iterations
- [ ] All three have re-review honesty framing
- [ ] All three have exit gates for review loop
- [ ] Re-audit scores: dev >= 9.5, ds >= 9.5, writing >= 9.5

**Current: 0/6 complete** (baseline audit complete)
