---
name: iteration-topology
description: Each phase uses a specific iteration strategy with defined exit gates and escalation triggers
applies-to: [writing-setup, writing-outline, writing-draft, writing-validate, writing-review, writing-revise]
---

## Rule

Each phase uses the iteration strategy best suited to its work:

| Phase | Topology | Exit Gate | Escalate When |
|-------|----------|-----------|---------------|
| **Setup** | One-shot + verify | PRECIS reviewer APPROVED | 5 iterations without approval |
| **Outline** | One-shot + verify | Outline reviewer APPROVED | 5 iterations without approval |
| **Draft** | Serial (per section) | All sections pass depth check | 5+ iterations on same section |
| **Validate** | One-shot | VALIDATION.md status = validated | Gaps found (user decision) |
| **Review** | Team (parallel or sequential reviewers) | All 3 levels complete | Reviewers diverge on direction |
| **Revise** | Serial hypothesis (audit-fix loop) | Zero issues in re-review | 3 iterations without convergence |

### Progress Gating

**If 5+ iterations on the same artifact without meaningful progress, STOP and escalate to the user.**

Signs you are stuck:
- Rewriting the same section repeatedly without quality improvement
- Cycling between two approaches
- Unable to find evidence for a claimed point
- Reviewer keeps flagging the same issue after "fixes"

**Spinning without progress is anti-helpful.** Recognizing when to ask for guidance is competence, not weakness.

## Rationale

**Why this exists** -- different phases have fundamentally different work patterns. Setup is a one-shot creation, drafting is serial across sections, review is parallel evaluation. Using the wrong topology (e.g., iterating on the entire draft instead of per-section) wastes context and produces unfocused revisions. The escalation triggers prevent infinite loops where the agent keeps trying the same approach without progress.

## Examples

### Correct

```
# Draft phase -- serial per section:
1. Draft Part I -> depth check -> pass
2. Draft Part II -> depth check -> fail (shallow treatment of CLAIM-02)
3. Revise Part II -> depth check -> pass
4. Draft Part III -> depth check -> pass
Gate: All sections pass depth check. Proceed to Validate.

# Revise phase -- audit-fix loop:
Iteration 1: 8 issues -> fix -> re-review: 3 issues remaining
Iteration 2: 3 issues -> fix -> re-review: 1 issue remaining
Iteration 3: 1 issue -> fix -> re-review: 0 issues
Gate: Zero issues. Proceed to Done.
```

### Incorrect

```
# Draft phase -- wrong topology:
1. Draft all sections at once
2. "Looks complete, moving on"
(No per-section depth check. No serial iteration. Shallow sections slip through.)

# Revise phase -- no escalation:
Iteration 1: 5 issues -> fix -> re-review: 4 issues
Iteration 2: 4 issues -> fix -> re-review: 5 issues (worse!)
Iteration 3: 5 issues -> fix -> re-review: 4 issues
Iteration 4: 4 issues -> fix -> re-review: 5 issues
... (cycling forever without escalating)
```

## Iteration Facts

- Drafting all sections at once produces shallow treatment — the serial topology exists because depth issues are only caught per section.
- The 4th attempt rarely succeeds where 3 failed, and the same flags after fixes mean the *approach* is wrong, not the effort insufficient. Track issue count per iteration: if it isn't dropping, you're cycling, not progressing — escalate with a diagnosis of why you're stuck, not another iteration.

## Red Flags

- **Issue count increasing across iterations** -- STOP. You're making things worse. Escalate immediately.
- **Same issue flagged after "fixing" it** -- STOP. Your fix approach is wrong. Escalate for guidance.
- **5+ iterations on the same artifact** -- STOP. Hard escalation trigger. Present diagnosis to user.
- **Drafting all sections simultaneously instead of serially** -- STOP. Use the serial topology for drafting.
- **Skipping the depth check between sections** -- STOP. Each section must pass before moving to the next.
