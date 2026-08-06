---
name: progress-gating
description: If 5+ iterations on the same artifact without meaningful progress, STOP and escalate
applies-to: [writing, writing-setup, writing-outline, writing-draft, writing-validate, writing-verify, writing-revise, writing-precis-reviewer, writing-outline-reviewer]
---

## Rule

**If 5+ iterations on the same artifact without meaningful progress, STOP and escalate to the user.**

Signs you are stuck:
- Rewriting the same section repeatedly without quality improvement
- Cycling between two approaches
- Unable to find evidence for a claimed point
- Reviewer keeps flagging the same issue after "fixes"

**Spinning without progress is anti-helpful.** Recognizing when to ask for guidance is competence, not weakness.

## Rationale

**Why this exists** — agents can enter infinite loops where each iteration feels productive but produces no net improvement. This is especially common in review-revise cycles where a fix for one issue reintroduces a previously fixed issue. Without a hard iteration limit, the agent burns context window and produces no better output than iteration 2. Escalating to the user after 5 iterations surfaces the underlying problem (ambiguous requirements, conflicting constraints, insufficient source material) that the agent cannot resolve alone.

## Examples

### Correct
1. After 5 iterations on the same section outline, agent stops: "I've iterated 5 times on Section 3 without convergence. The reviewer keeps flagging [specific issue]. This may need your input on [specific decision]."
2. After 3 iterations cycling between two structures, agent recognizes the pattern early and escalates before hitting the limit.

### Incorrect
1. Agent rewrites the same paragraph 8 times, each time believing "this version is better."
2. Agent cycles between approach A and approach B for 6 iterations without noticing the pattern.
3. Reviewer flags "insufficient evidence for CLAIM-02" three times; agent keeps rephrasing the claim instead of asking the user for additional sources.

## Escalation Facts

- If the reviewer flags the same issue after your "fix", you are not making progress — "this next iteration will fix it" is what iteration 3 said. Count, don't feel.
- Escalating at 5 iterations is competence; spinning to 10 without progress IS incompetence dressed as persistence. The user wants quality output, not protection from questions — escalate with a specific question.

## Red Flags

- **"One more try"** → STOP. Count your iterations. If 5+, escalate.
- **"I'm almost there"** → STOP. "Almost" after 5 iterations means you're stuck, not close.
- **"The fix is obvious now"** → STOP. If it were obvious, you'd have found it in iteration 1-4.
- **Reviewer flags the same issue after your fix** → STOP. Your fix didn't work. Escalate.
