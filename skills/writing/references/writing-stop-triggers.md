---
name: writing-stop-triggers
description: Common rationalizations that cause main chat to bypass writing workflow structure
applies-to: [writing-draft, writing-verify, writing-revise]
---

## Rule

These are the most common rationalizations that cause main chat to bypass the writing workflow structure. Each one feels productive but actually undermines the phased process. If you catch yourself doing any of these, **STOP immediately**.

## Rationale

**Why this exists** — each of these actions feels helpful in the moment but bypasses the constraint loading, review pipeline, or phase structure that the writing workflow enforces. The pattern is always the same: agent takes a "quick" action that skips the structured process, producing output that violates constraints the process would have caught. These specific triggers were identified from real workflow violations.

## Examples

### Correct
1. Agent needs to check tone → Loads domain skill + ai-anti-patterns → Invokes /writing-verify.
2. Agent sees a typo in the draft → Notes it for the revision phase → Continues current phase.
3. Subagent returns a draft → Agent reports the subagent returned → Invokes next skill.

### Incorrect
1. Agent reads a draft file "just to see how it's going" outside of any phase skill.
2. Agent "polishes a paragraph" mid-outline phase.
3. Agent summarizes a subagent's draft in its own words (rewriting disguised as reporting).

## Red Flags

| Action | Why Wrong | Do Instead |
|--------|-----------|------------|
| Reading a draft file outside of a phase skill | Bypasses constraint loading; you'll form opinions and start editing | Load the appropriate skill first |
| "Let me check the tone" without loading domain skill + ai-anti-patterns | Partial evaluation is worse than no evaluation — it creates false confidence | Load ALL constraint layers, then evaluate via the review skill |
| "Quick edit to the intro" without REVIEW.md | Unstructured edits bypass review → revise pipeline | Run /writing-verify first, then /writing-revise |
| Editing prose after reading REVIEW.md (skipping /writing-revise) | REVIEW.md is for /writing-revise to consume, not for main chat to act on directly | Invoke /writing-revise |
| "Let me polish this paragraph" mid-workflow | Polish is revision work; doing it ad-hoc bypasses the revision skill's constraint loading | Continue current phase; polish during revision |
| Summarizing a subagent's draft in your own words | You're rewriting, not summarizing. This is investigation disguised as reporting. | Report the subagent returned, invoke next skill |
| "The draft is almost done, let me finish it myself" | "Almost done" is the most dangerous state — you'll skip the remaining phases | Follow the workflow to completion |
| Reading `references/` source material to "verify" claims | Fact-checking IS investigation. Delegate to a review subagent. | Spawn a review subagent with fact-checking instructions |

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "I'm just reading, not editing" | Reading forms opinions. Opinions become edits. Edits bypass constraints. | Don't read draft prose outside a phase skill |
| "This is faster than spawning a subagent" | Faster ≠ better. The subagent loads constraints; you didn't. | Spawn the subagent |
| "It's just one paragraph" | One paragraph becomes two. Two becomes a section. Then you've rewritten the draft. | STOP. Invoke the appropriate skill. |
| "The subagent will take too long" | The subagent takes minutes. Fixing your unstructured edits takes hours. | Spawn the subagent |
