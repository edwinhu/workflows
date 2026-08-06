---
name: writing-outline-sync
description: OUTLINE.md section structure and Preview/Restatement numbers should match drafts/; framing is phase-aware (OUTLINE canonical during setup/outline/draft; drafts canonical during review/revise)
applies-to: [writing-draft, writing-verify, writing-revise]
severity: soft
---

## Rule

`OUTLINE.md` encodes the planned section structure and key empirical numbers for a writing project. It must stay in sync with the actual draft files in `drafts/` or the Level 1 structure reviewer generates false-positive violations — flagging compliant draft sections as "out-of-compliance" because it treats OUTLINE as authoritative when OUTLINE is the stale party.

### Structural sync

Every `##`-level subsection with a letter prefix (`A.`, `B.`, ...) in a draft file should appear in `OUTLINE.md` under the matching `###` part section, and vice versa.

Every `###`-level sub-subsection in a draft file should be referenced somewhere in the OUTLINE body for its part.

### Number-anchoring sync

Empirical numbers in the OUTLINE Introduction and Conclusion sections (the "Preview of findings" and "Restatement" bullets) should appear in at least one draft file. If a number appears in OUTLINE but not in any draft, the OUTLINE is likely stale relative to an updated analysis.

This check is scoped to Introduction and Conclusion only because those sections carry the terminal summary of the paper's findings. Numbers in intermediate sections (Part I–IV body bullets, Key Sources, Claim-to-Part Map, Open Questions) are planning notes, not restatements.

## Phase-Aware Framing

The check reads `.planning/ACTIVE_WORKFLOW.md` for the `phase:` field and changes violation framing accordingly:

| Phase | Canonical party | Violation framing |
|-------|-----------------|-------------------|
| `setup`, `outline`, `draft` | OUTLINE | Draft deviated from plan |
| `review`, `revise`, `validate`, `complete` | Drafts | OUTLINE is stale |
| Unknown / missing | Drafts (default) | OUTLINE is stale |

## What Does Not Trigger This Check

- `##` subsections without a leading letter prefix (non-standard structure — not tracked)
- `###` sub-subsections whose key phrase appears anywhere in the OUTLINE body (e.g., "Quorum failures" in OUTLINE bullets → `### Quorum failures` in draft passes)
- Numbers in Key Sources lists, Claim-to-Part Map rows, Open Questions blocks (these are planning or citation metadata, not findings)
- Bullets beginning with an author-year citation pattern (`Smith 2024`, `Bebchuk/Hirst 2019`)
- OUTLINE parts with no draft file when phase ∈ {setup, outline} — normal state before drafting begins

## Rationale

The canonical failure mode: author updates data, draft numbers change (e.g., flip count 15→14), OUTLINE is not updated. At the next `/writing-verify` run, the Level 1 structure reviewer sees "OUTLINE says 15, draft says 14" and flags the draft as non-compliant — but the draft is correct and OUTLINE is stale. The reviewer burns an entire review-revise iteration on a false positive, and the author has to manually reconcile.

The structural failure mode: author adds a new `### Force-voting robustness` sub-subsection during revision. OUTLINE has no entry for it. The reviewer flags the draft as adding content outside the plan. At review phase, the plan should follow the prose, not constrain it.

This check surfaces both failure modes as soft warnings at the top of the review hard gate, before Level 1 begins, so the author can update OUTLINE before review proceeds.

## Examples

**Draft section with no OUTLINE counterpart (phase=review)**:
```
WARN: drafts/Part III (Draft).md [phase=review]: ### Force-voting robustness
not mentioned in OUTLINE under 'Part III. Findings' — OUTLINE may need a
new entry
```
Fix: add a mention of "force-voting robustness" to the OUTLINE Part III.B bullet.

**Stale number in OUTLINE Conclusion (phase=review)**:
```
WARN: .planning/OUTLINE.md (Conclusion) [phase=review]: number '15' not
found in any draft — OUTLINE restatement may be stale: "- **Restatement**:
mirror voting ... flipped 0.002% of outcomes (15 of 614,490 mirror-valid
items) — ~200× fewer..."
```
Fix: update the Conclusion Restatement bullet to the current number (14, 602,689, 0.0023%, 124×).

**Draft adds a section not in OUTLINE (phase=draft)**:
```
WARN: drafts/Part II (Draft).md [phase=draft]: ## E. added in draft but not
planned in OUTLINE under 'Part II. ...' — update OUTLINE or confirm this
subsection belongs
```
Fix: either add `- **E. [title]**` to the OUTLINE under Part II, or fold the new section back into a planned section.

## Outline-Sync Facts

- A stale OUTLINE fires the same false-positive review violation on every run until fixed, burning a review-revise iteration each time — sync OUTLINE immediately after changing draft structure or numbers, before running review.
- OUTLINE Introduction and Conclusion bullets are restatements that must match the draft; Part body bullets are planning notes and need not.
- Reviewer subagents can confabulate which side of a number mismatch is correct; the mechanical check is the reliable arbiter — trust the check and update OUTLINE.
