---
name: writing-learnings-log
description: Append-only cross-phase decision log (.planning/LEARNINGS.md) plus the soft observe-record-offer loop for review checkpoints
applies-to: [writing, writing-setup, writing-outline, writing-draft, writing-validate, writing-review, writing-revise]
---

## Rule

Writing spans 6+ phases across multiple sessions. Argument decisions, rejected framings, and review priorities accumulate in transient chat context and are lost at handoff. `.planning/LEARNINGS.md` is the durable home for them — the same append-only decision log used by the dev and ds workflows.

`.planning/LEARNINGS.md` is a **standard state file** of the writing workflow (alongside `ACTIVE_WORKFLOW.md`, `PRECIS.md`, `OUTLINE.md`). Create it at setup; append to it, never rewrite it.

### What each phase appends

A short dated bullet at each phase gate — not a form, just the choices a future session (or a fresh subagent) could not reconstruct from the artifacts alone:

| Phase | Append |
|-------|--------|
| brainstorm | Chosen angle/audience and the framings considered-and-rejected |
| lit-review | Source gaps accepted (and why), themes dropped |
| setup | Scope In/Out decisions, claims cut from PRECIS |
| outline / draft | R4 restructurings, structural discoveries, deviations (R1–R3 counts) |
| review / revise | Which review findings the user prioritized or overrode |

Keep entries terse. The test: *if a new session resumed here, what decision would it otherwise repeat or reverse by mistake?* Log that.

## The Observe → Record → Offer Loop (soft — never a hard requirement)

At decision checkpoints (review gate, validate gaps-found, revise escalation), **observe** what the human actually attends to and **record** it in LEARNINGS.md (e.g., "user re-read claim-coverage table again", "user asked for the redline view").

**Only after the same view has been requested 3+ times**, *offer* — do not impose — to script it. Candidate writing-domain views: a claim-coverage summary from `VALIDATION.md`, a DOCX redline from `REVIEW.md`, an argument-structure map from `OUTLINE.md`.

<EXTREMELY-IMPORTANT>
**Visual output is NEVER a hard requirement at any checkpoint.** A text summary is the default. Forcing a chart, heatmap, or diagram the user did not ask for is busy-work, not quality — it adds friction to checkpoints that work fine as text. The loop is observe-first, offer-after-3, automate-only-on-request. Do not prescribe a visual artifact as a gate condition.
</EXTREMELY-IMPORTANT>

This is the principled middle ground: the decision log is mandatory (it's structural state); the visual artifacts are emergent and optional (they're UX, which must follow observed behavior, not precede it).
