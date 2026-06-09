---
name: writing-handoff
description: "Create structured handoff document for writing workflow session pause/resume."
user-invocable: false
disable-model-invocation: true
---

Announce: "Using writing-handoff to capture session state for clean resumption."

## Contents

- [The Iron Law of Handoff](#the-iron-law-of-handoff)
- [Red Flags](#red-flags)
- [Process](#process)
- [Handoff Template](#handoff-template)
- [Handoff Facts](#handoff-facts)

# Session Handoff

Capture current writing workflow state into `.planning/HANDOFF.md` so a fresh session can resume exactly where this one left off.

<EXTREMELY-IMPORTANT>
## The Iron Law of Handoff

**NO HANDOFF WITHOUT READING STATE FIRST. This is not negotiable.**

Before writing `.planning/HANDOFF.md`, you MUST:
1. READ `.planning/PRECIS.md` (if exists) — understand the argument and claims
2. READ `.planning/OUTLINE.md` (if exists) — understand section structure and mapping
3. READ `.planning/ACTIVE_WORKFLOW.md` (if exists) — understand current phase and progress
4. ASSESS what is actually done vs. what remains
5. Only THEN write the handoff document

**If you catch yourself writing a handoff without reading state files first, STOP.**
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## Red Flags

- About to write a handoff from memory without reading the state files → STOP. Memory degrades across long sessions — sections blur together; read the files and write from evidence.
- About to write a brief handoff or "just note the current section" → STOP. A section name without which claims it serves, what's drafted vs. outlined, and the next action forces full re-discovery — the next session knows NOTHING.
- About to skip the handoff because "we're almost done" → STOP. Near-complete is the most dangerous state to lose — one missed section derails review.
- About to rely on state files alone → STOP. State files track structure, not session context; add the decisions, pivots, and rejected framings that are NOT in the files.
- About to leave resumption to the user ("they can figure out where we left off") → STOP. Argument decisions, rejected framings, and section dependencies cannot be reconstructed from artifacts; write them all down.
</EXTREMELY-IMPORTANT>

## Process

### Step 1: Read Current State

Read all available state files to understand where we are:

```
1. Read .planning/PRECIS.md → argument claims and commitments
2. Read .planning/OUTLINE.md → section structure and claim mapping
3. Read .planning/ACTIVE_WORKFLOW.md → current phase, style, progress
4. Read .planning/VALIDATION.md (if exists) → coverage status
5. Scan recent git log → what's been committed
6. Check for uncommitted changes → what's in-flight
```

**Run:**
```bash
# Check for uncommitted work
git status --short 2>/dev/null

# Recent commits in this session
git log --oneline -10 2>/dev/null
```

**Description:** writing-handoff: read current workflow and git state

### Step 2: Assess Progress

From the state files and git history, determine:
- **Current phase** (setup / outline / draft / validate / review / revise)
- **Which sections are complete** (from git history, drafts/ directory, ACTIVE_WORKFLOW.md)
- **Which section is in progress** (from uncommitted changes)
- **Argument state** (from PRECIS.md — which claims are drafted, which are pending)
- **Decisions made during this session** (from session context — style choices, argument pivots)
- **Blockers encountered** (from session context)

### Step 3: Write Handoff Document

Write `.planning/HANDOFF.md` using the template below. Every field is mandatory.

<EXTREMELY-IMPORTANT>
**The next session starts with ZERO context. If it's not in the handoff, it doesn't exist.**

Write as if briefing a colleague who has never seen this project. Include:
- The specific section you were drafting/reviewing and why
- The argument direction you chose and alternatives you rejected
- Any structural discoveries (sections that need merging, claims that need splitting, transitions that don't work)
- The EXACT next action (not "continue writing" — what specifically to do first)
</EXTREMELY-IMPORTANT>

### Step 4: Verify Handoff

After writing, verify the handoff is complete:

```
1. IDENTIFY: .planning/HANDOFF.md exists
2. READ: Re-read the handoff document
3. VERIFY: Contains all sections (Current State, Completed Work, Remaining Work, Decisions, Next Action)
4. VERIFY: "Next Action" is specific enough to start immediately
5. VERIFY: Frontmatter phase/section numbers are accurate
```

**If any section is empty or vague, fix it before confirming handoff.**

## Handoff Template

```markdown
---
phase: [current phase number]
phase_name: [setup|outline|draft|validate|review|revise]
section_in_progress: [current section name or "none"]
total_sections: [N from OUTLINE.md]
status: paused
last_updated: [ISO 8601]
---
# Session Handoff

## Current State
[Where exactly we are — the immediate context a new session needs.
Include: current section being drafted/revised, current phase,
current gate status, which PRECIS claims are covered. Be specific.]

## Completed Work
- [x] Section I: [name] — Drafted ([brief note on argument])
- [x] Section II: [name] — Drafted
- [ ] Section III: [name] — In progress ([what's drafted, what's not])

## Remaining Work
- Section III: [what specifically remains — which outline points are unexpanded]
- Section IV: [name] — Not started
- Validation — Not run yet

## Decisions Made
- [Style choice]: [what was decided and WHY — e.g., "Chose to lead with empirical finding rather than doctrinal framework because audience is policy-oriented"]
- [Argument direction]: [what was decided and WHY — e.g., "Framed counterargument as steelman rather than strawman to strengthen Section IV rebuttal"]

## Rejected Approaches
- [Framing]: [why it was rejected — saves the next session from re-exploring dead ends]
- [Structure]: [e.g., "Tried putting methodology in Section I but it buried the hook — moved to Section II"]

## Blockers
- [Blocker]: [status/workaround found]
- (none) — if no blockers

## Uncommitted Changes
- [file]: [what was changed and why]
- (none) — if all work is committed

## Next Action
Start with: [specific first action when resuming — not "continue Section III" but
"Open outlines/Section III (Outline).md and expand points 3.2-3.4 into prose,
focusing on the counterargument to Smith (2024) that PRECIS.md commits to addressing.
The first two subsections are drafted in drafts/Section III (Draft).md."]
```

## Handoff Facts

- State files don't capture session decisions, rejected framings, or in-flight argument pivots — they track structure. A handoff that omits what's NOT in the files throws away the work that produced those decisions.
- Git history shows WHAT changed, not WHY or WHAT'S NEXT — pointing the next session at git history is not a handoff.
- ACTIVE_WORKFLOW.md carries phase tracking; the handoff carries intent, decisions, and the next action. Substituting one for the other loses exactly the half that cannot be reconstructed — a resumption that starts slower than a fresh start, which defeats the point of pausing cleanly.

## Completion

After writing and verifying `.planning/HANDOFF.md`:

Announce: "Session handoff saved to .planning/HANDOFF.md. Next session will detect it automatically and offer to resume."

Report to user:
```
Handoff saved:
- Phase: [phase_name]
- Section: [section_in_progress] ([N] of [total] sections)
- Next action: [one-line summary]

Resume by starting /writing in this project — it will detect the handoff.
```
