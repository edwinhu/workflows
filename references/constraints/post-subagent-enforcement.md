---
name: post-subagent-enforcement
description: After any subagent returns, main chat MUST NOT read drafts or edit prose
applies-to: [writing, writing-review, writing-revise]
---

## Rule

When a subagent returns (review subagent, draft subagent, outline reviewer), main chat MUST NOT read source files, edit draft content, or "check" quality directly. Only verification actions are allowed.

<EXTREMELY-IMPORTANT>
### The Iron Law of Post-Subagent Boundaries

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

### Why This Exists

The moment main chat reads a draft, it forms opinions about quality. Those opinions bypass the structured review process. Main chat starts "improving" text that the review subagent should be evaluating. This is how structured workflows collapse into unstructured editing sessions.
</EXTREMELY-IMPORTANT>

## Rationale

**Why this exists** — dev-debug (March 16, 2026) documented 71 protocol violations when main chat "verified" subagent work by reading source code directly. The pattern is: main chat reads content → forms opinions → starts editing → abandons structured process. In writing workflows, this means main chat reads a draft after review → decides to "fix the tone" → bypasses constraint loading and the revision skill → produces unstructured edits that violate domain style rules and AI anti-patterns.

## Examples

### Correct
1. Review subagent returns REVIEW.md. Main chat checks REVIEW.md exists, reads issue count (3 major, 2 minor), invokes /writing-revise.
2. Draft subagent returns. Main chat counts files in `drafts/`, verifies all expected sections exist, updates ACTIVE_WORKFLOW.md, proceeds to validation.

### Incorrect
1. Review subagent returns REVIEW.md. Main chat "reads the draft to understand the review better" → starts editing the introduction → bypasses /writing-revise.
2. Draft subagent returns. Main chat "checks the tone of the opening paragraph" → decides it needs work → starts rewriting without loading constraint layers.

## Post-Subagent Facts

- REVIEW.md already summarizes every issue with citations — reading the draft "to understand the review" is investigation, and "glance" becomes "read" becomes "edit" becomes an unstructured session. Verifying the subagent's fixes means checking REVIEW.md exists with issues resolved — artifact existence, never prose content.
- Quick edits and tone checks bypass constraint loading and review — they go through /writing-revise and /writing-review. A review that "missed something obvious" gets a fresh review subagent; re-review will catch it.

## Red Flags

- **"Let me read the draft"** → STOP. That's investigation. Invoke /writing-revise.
- **"Let me check the tone"** → STOP. Tone checking is review work. Spawn a review subagent.
- **"Quick edit to the intro"** → STOP. All edits go through /writing-revise with full constraint loading.
- **"Let me verify the changes look right"** → STOP. Check artifact existence (REVIEW.md, draft file count), not content.
- **"I'll just read one section"** → STOP. One section becomes all sections. Subagent.
- **"The subagent's review seems thin, let me supplement it"** → STOP. Spawn a fresh review subagent with stricter instructions.
