---
name: writing-validate
description: "Validate draft sections cover all PRECIS claims before review."
---

Announce: "Using writing-validate (Phase 3.5) to validate draft sections against PRECIS.md claims."

## Contents

- [The Iron Law of Validation](#the-iron-law-of-validation)
- [Red Flags - STOP Immediately](#red-flags---stop-immediately)
- [Purpose](#purpose)
- [Validation Levels](#validation-levels)
- [The Process](#the-process)
- [Classification](#classification)
- [VALIDATION.md Template](#validationmd-template)
- [Gate](#gate)
- [Rationalization Prevention](#rationalization-prevention)
- [Drive-Aligned Framing](#drive-aligned-framing)
- [Phase Transition](#phase-transition)

# Claim Validation Against PRECIS.md

Phase between draft and review. Maps every PRECIS.md claim to a draft section and verifies coverage. This is the writing equivalent of DS's DQ validation — without it, review checks quality on prose that may not even address the argument.

<EXTREMELY-IMPORTANT>
## The Iron Law of Validation

**NO REVIEW WITHOUT CLAIM VALIDATION. This is not negotiable.**

writing-review MUST NOT start until `.planning/VALIDATION.md` confirms all PRECIS claims are addressed in drafts. Validation is the writing equivalent of test coverage — without it, review is theater.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## Red Flags - STOP Immediately If You Catch Yourself Thinking:

| Thought | Why It's Wrong | Do Instead |
|---------|----------------|------------|
| About to invoke writing-review without VALIDATION.md | Review checks quality, not coverage. Unvalidated drafts may miss entire claims. | Run validation first. |
| Claiming "all claims covered" without reading each draft section | You cannot verify coverage without reading the prose | Read every draft file and check against every PRECIS claim |
| Skipping validation because "the piece is short" | Short pieces still drop claims — fewer sections means each must carry more weight | Validate every piece, regardless of length |
| Marking a claim as COVERED when the draft only mentions it without arguing it | Mentioning ≠ arguing. A passing reference is not substantive coverage. | Classify as PARTIAL and flag the gap |
</EXTREMELY-IMPORTANT>

## Purpose

This phase sits between writing-draft and writing-review. Its job is to ensure every claim in PRECIS.md has substantive coverage in the drafts before review begins. Review checks prose quality, argument strength, and structural coherence — it should NOT be discovering that entire claims were dropped.

## Validation Levels

Each PRECIS claim is validated at four levels, in order:

| Level | Check | Example |
|-------|-------|---------|
| 1. Exists | Draft section present for this claim | `drafts/Part II (Draft).md` exists |
| 2. Substantive | Real argument, not placeholder | >200 words, includes reasoning |
| 3. Supported | Evidence/citations present | At least one source per major claim |
| 4. Addresses Claim | Section actually argues the PRECIS claim | Thesis threading intact, not a tangent |

## The Process

```
1. READ .planning/PRECIS.md — extract all claims
2. READ .planning/OUTLINE.md — map claims to sections
3. For each claim: READ the corresponding draft in drafts/
4. CLASSIFY each claim: COVERED / PARTIAL / MISSING
5. For MISSING: flag to user (do NOT auto-draft)
6. WRITE .planning/VALIDATION.md
```

### Step 1: Extract Claims from PRECIS

Read `.planning/PRECIS.md` and extract every claim:

```
For each claim in PRECIS.md:
  - Main claims (thesis, sub-theses)
  - Counterarguments to be addressed
  - Audience-specific framing commitments
  - Evidence commitments ("I will show X using Y")
```

### Step 2: Map Claims to Sections

Read `.planning/OUTLINE.md` and map each PRECIS claim to one or more sections:

```
For each claim:
  - Which section(s) in OUTLINE.md address this claim?
  - Is any claim orphaned (no section maps to it)?
  - Is any section present that doesn't serve a claim?
```

### Step 3: Read and Verify Each Draft

For each claim, read the corresponding draft file in `drafts/`:

```
For each mapped section:
  - Does the draft file exist?
  - Is the content substantive (>200 words, real argument)?
  - Are evidence/citations present for the claim?
  - Does the section actually ARGUE the PRECIS claim, or just mention it?
```

### Step 4: Classify

For each PRECIS claim, assign a classification:

| Classification | Criteria |
|---------------|----------|
| **COVERED** | All 4 validation levels pass — section exists, is substantive, has evidence, and argues the claim |
| **PARTIAL** | Section exists but has weak evidence, is too short, or tangential to the claim |
| **MISSING** | No draft section addresses this claim |

### Step 5: Flag Gaps to User

<EXTREMELY-IMPORTANT>
**Do NOT auto-draft missing or partial claims. Writing requires human judgment on argument direction.**

When gaps are found, present them to the user and wait for a decision:
- **Fix**: Return to writing-draft to address the gap
- **Accept**: Proceed to writing-review with known gaps

This is the critical difference from automated validation. In writing, a missing claim may mean the argument needs restructuring, the claim should be dropped, or the approach needs rethinking. Only the user can judge.
</EXTREMELY-IMPORTANT>

### Step 6: Write VALIDATION.md

Compile all results into `.planning/VALIDATION.md` using the template below.

## VALIDATION.md Template

```markdown
---
status: validated | gaps_found
date: [ISO 8601]
claims_total: N
covered: N
partial: N
missing: N
---
# Claim Validation

## Claims Map
| # | PRECIS Claim | Draft Section | Evidence Count | Level 1 (Exists) | Level 2 (Substantive) | Level 3 (Supported) | Level 4 (Addresses Claim) | Classification |
|---|-------------|---------------|----------------|-------------------|-----------------------|---------------------|---------------------------|----------------|
| 1 | [from PRECIS] | [drafts/Section.md] | 3 | PASS | PASS | PASS | PASS | COVERED |
| 2 | [from PRECIS] | [drafts/Section.md] | 1 | PASS | PASS | WARN | PASS | PARTIAL |
| 3 | [from PRECIS] | — | 0 | FAIL | — | — | — | MISSING |

## Gap Details
[For any PARTIAL or MISSING claim, include the specific finding:
- What's missing or weak
- Which validation level failed
- Suggested remediation (for user decision)]

## Summary
- Claims: N total
- Covered: X
- Partial: Y
- Missing: Z
```

### Status Rules

| Condition | Status |
|-----------|--------|
| All claims COVERED | `validated` |
| Any PARTIAL or MISSING remain | `gaps_found` |

## Gate

`.planning/VALIDATION.md` must exist before proceeding.

- If status is `validated`: proceed to writing-review.
- If status is `gaps_found`: present gaps to user before proceeding.
  - User decides: **fix** (return to writing-draft) or **accept** (proceed to writing-review with known gaps).

<EXTREMELY-IMPORTANT>
**Do NOT silently proceed past gaps. Present them and wait for user decision.**

Gaps in claim coverage are not cosmetic — they mean the argument has holes. Only the user can decide whether a gap is acceptable or requires returning to the draft phase.
</EXTREMELY-IMPORTANT>

## Rationalization Prevention

| Thought | Reality |
|---------|---------|
| "The draft covers everything" | Self-assessment misses dropped claims. You wrote the drafts — you're the worst judge of what's missing. |
| "Review will catch missing claims" | Review checks quality, not coverage. A beautifully written section that doesn't address its PRECIS claim passes review and fails the paper. |
| "PRECIS claims are implicit in the draft" | Implicit ≠ addressed. Map explicitly. If you can't point to the paragraph that argues the claim, it's not covered. |
| "Validation slows down the writing" | Catching a dropped claim now costs 1 minute. Catching it in review costs a rewrite. Catching it after publication costs credibility. |
| "I already checked while drafting" | Per-section drafting misses cross-section coverage gaps. A claim that spans two sections can fall between them. |

## Drive-Aligned Framing

<EXTREMELY-IMPORTANT>
**Skipping validation is NOT HELPFUL — you're sending prose to review that may not even address the argument the user committed to.**

| Your Drive | Why You Skip | What Actually Happens | The Drive You Failed |
|------------|-------------|----------------------|---------------------|
| **Helpfulness** | "Drafts exist, review can check coverage" | Review checks prose quality, not claim coverage. User discovers a dropped thesis point during faculty feedback. | **Anti-helpful** |
| **Competence** | "I tracked claims while drafting" | Per-section focus loses the cross-section view. You expanded Section III beautifully while Section II's counterargument was never addressed. | **Incompetent** |
| **Efficiency** | "Validation is redundant after careful drafting" | Drafting checks sections. Validation checks claims. Different axes. A 5-minute validation prevents a 2-hour rewrite. | **Anti-efficient** |

**The protocol is not overhead you pay. It is the safety net you provide.**
</EXTREMELY-IMPORTANT>

## Phase Transition

After validation is complete, discover and read the writing-review skill:
```bash
command ls -d ~/.claude/plugins/cache/edwinhu-plugins/workflows/*/skills/writing-review/SKILL.md 2>/dev/null | sort -V | tail -1
```
Use the output path with `Read()`.
