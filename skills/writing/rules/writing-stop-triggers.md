---
name: writing-stop-triggers
applies-to: [writing-draft, writing-verify, writing-revise]
---

## Rule

These are the most common rationalizations that cause main chat to bypass the writing workflow structure. Each one feels productive but actually undermines the phased process. If you catch yourself doing any of these, **STOP immediately**.

## Rationale

**Why this exists** — each of these actions feels helpful in the moment but bypasses the constraint loading, review pipeline, or phase structure that the writing workflow enforces. The pattern is always the same: agent takes a "quick" action that skips the structured process, producing output that violates constraints the process would have caught. These specific triggers were identified from real workflow violations.

## Examples

### Correct
1. Agent needs to check tone → Loads domain skill + ai-anti-patterns → Dispatches the `writing-reviewer` agent.
2. Agent sees a typo in the draft → Notes it for the next `/writing` pass → Continues current phase.
3. Subagent returns a draft → Agent reports the subagent returned → Routes the next step through `/writing`.

### Incorrect
1. Agent reads a draft file "just to see how it's going" outside `/writing` or the `writing-reviewer` agent.
2. Agent "polishes a paragraph" in main chat instead of routing the edit through `/writing`.
3. Agent summarizes a subagent's draft in its own words (rewriting disguised as reporting).

## Red Flags

| Action | Why Wrong | Do Instead |
|--------|-----------|------------|
| Reading a draft file outside of `/writing` or the `writing-reviewer` agent | Bypasses constraint loading; you'll form opinions and start editing | Route through `/writing` or dispatch `writing-reviewer` |
| "Let me check the tone" without loading domain skill + ai-anti-patterns | Partial evaluation is worse than no evaluation — it creates false confidence | Load ALL constraint layers, then evaluate via the `writing-reviewer` agent |
| "Quick edit to the intro" in main chat | Unstructured edits bypass the work loop's gate and review | Route the edit through `/writing` |
| Editing prose after reading the `writing-reviewer`'s findings | The findings are for the `/writing` work loop to act on, not for main chat to apply by hand | Route the fixes through `/writing` |
| "Let me polish this paragraph" mid-workflow | Polish is an edit; doing it ad-hoc bypasses the writing agent's constraint loading | Route the polish through `/writing` |
| Summarizing a subagent's draft in your own words | You're rewriting, not summarizing. This is investigation disguised as reporting. | Report the subagent returned, route the next step through `/writing` |
| "The draft is almost done, let me finish it myself" | "Almost done" is the most dangerous state — you'll skip the remaining phases | Follow the workflow to completion |
| Reading `references/` source material to "verify" claims | Fact-checking IS investigation. Delegate to a review subagent. | Spawn a review subagent with fact-checking instructions |

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "I'm just reading, not editing" | Reading forms opinions. Opinions become edits. Edits bypass constraints. | Don't read draft prose outside `/writing` or the `writing-reviewer` agent |
| "This is faster than spawning a subagent" | Faster ≠ better. The subagent loads constraints; you didn't. | Spawn the subagent |
| "It's just one paragraph" | One paragraph becomes two. Two becomes a section. Then you've rewritten the draft. | STOP. Route it through `/writing`. |
| "The subagent will take too long" | The subagent takes minutes. Fixing your unstructured edits takes hours. | Spawn the subagent |
