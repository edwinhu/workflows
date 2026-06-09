---
name: artifact-review-gates
description: Artifacts crossing phase boundaries must be independently reviewed by fresh subagents
applies-to: [writing-setup, writing-outline, writing-review, writing-outline-reviewer]
---

## Rule

Artifacts that cross phase boundaries MUST be independently reviewed:

| Artifact | Reviewer | Gate |
|----------|----------|------|
| PRECIS.md | writing-precis-reviewer (subagent) | Before OUTLINE.md creation |
| outlines/*.md | writing-outline-reviewer (subagent) | Before drafting begins |
| drafts/*.md | writing-review (3-level hierarchical) | Before revision begins |

**Self-review is rubber-stamping.** The reviewer must be a fresh subagent with no context from the writing phase.

### Post-Subagent Enforcement: Verification vs Investigation Boundary

When a subagent returns (review subagent, draft subagent, outline reviewer), main chat MUST NOT read source files, edit draft content, or "check" quality directly. Only verification actions are allowed.

**AFTER ANY SUBAGENT RETURNS, MAIN CHAT MUST NOT READ DRAFTS OR EDIT PROSE. This is not negotiable.**

This enforcement exists because dev-debug (March 16, 2026) showed that 71 protocol violations occurred when main chat "verified" subagent work by reading source code. The same pattern applies to writing: after a review subagent returns REVIEW.md, main chat must not "verify" by reading the draft, "check the tone", or "quickly fix the intro."

| Verification (main chat CAN do) | Investigation (main chat CANNOT do) |
|----------------------------------|--------------------------------------|
| Check that REVIEW.md exists | Read draft files in `drafts/` |
| Read REVIEW.md for issue count/severity | Edit any prose in `drafts/` or `outlines/` |
| Read ACTIVE_WORKFLOW.md for state | "Check the tone" of a section |
| Read PRECIS.md / OUTLINE.md for structure | "Polish" or "quickly fix" any passage |
| Count files in `drafts/` / `outlines/` | Read source material in `references/` |
| Update REVIEW_STATE.md iteration count | Rephrase, reword, or reorganize sections |
| Invoke the next skill (/writing-revise) | Run ai-anti-patterns checks directly on text |

**The test: If the action requires reading prose content (not metadata), it's investigation. Delegate to a subagent.**

The moment main chat reads a draft, it forms opinions about quality. Those opinions bypass the structured review process. Main chat starts "improving" text that the review subagent should be evaluating. This is how structured workflows collapse into unstructured editing sessions.

## Rationale

**Why this exists** -- the agent that wrote an artifact cannot objectively evaluate it. Writing creates cognitive investment: the author sees what they intended, not what they wrote. Fresh subagents catch issues the author is blind to. The dev-debug audit (March 16, 2026) demonstrated this with 71 protocol violations from main chat "verifying" subagent work.

## Examples

### Correct

```
# After PRECIS.md is written:
1. Spawn writing-precis-reviewer subagent
2. Subagent reads PRECIS.md, returns verdict
3. Main chat reads verdict (APPROVED/REVISION_NEEDED)
4. If APPROVED: proceed to outline phase
5. If REVISION_NEEDED: revise PRECIS.md, re-submit to fresh reviewer
```

### Incorrect

```
# After PRECIS.md is written:
"Let me review the PRECIS myself... looks solid. Moving to outline."
(Self-review. No subagent. No independent evaluation.)

# After review subagent returns:
"Let me read the draft to understand the review better..."
(Investigation. Main chat reading prose after subagent returned.)
```

## Review-Gate Facts

- REVIEW.md already summarizes every issue with citations — reading the draft "to understand the review" is investigation, and "glance" becomes "read" becomes "edit" becomes an unstructured session. Verifying the subagent's fixes means checking REVIEW.md exists with issues resolved — artifact existence, never prose content. Quick edits and tone checks bypass constraint loading; they go through /writing-revise and /writing-review.
- A review that "missed something obvious" gets a fresh review subagent — re-review will catch it; supplementing it yourself converts orchestration into review work.
- "I wrote it, I know what needs fixing" is exactly why you can't review it — author blindness is real. A fresh subagent is the only honest reviewer.

## Red Flags

- **"Let me review this myself before sending to the reviewer"** -- STOP. Self-review is rubber-stamping. Spawn the subagent.
- **"Let me read the draft to understand the review"** -- STOP. That's investigation. REVIEW.md has everything you need.
- **"Let me check the tone"** -- STOP. Tone checking is review work. Spawn a review subagent.
- **"Quick edit to the intro"** -- STOP. All edits go through /writing-revise with full constraint loading.
- **"Let me verify the changes look right"** -- STOP. Check artifact existence (REVIEW.md, draft file count), not content.
- **"I'll just read one section"** -- STOP. One section becomes all sections. Subagent.
- **"The subagent's review seems thin, let me supplement it"** -- STOP. Spawn a fresh review subagent with stricter instructions.
