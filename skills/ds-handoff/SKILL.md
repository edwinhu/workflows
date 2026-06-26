---
name: ds-handoff
description: "Create structured handoff document for DS workflow session pause/resume."
user-invocable: false
disable-model-invocation: true
---

Announce: "Using ds-handoff to capture session state for clean resumption."

## Contents

- [The Iron Law of Handoff](#the-iron-law-of-handoff)
- [Handoff Facts](#handoff-facts)
- [Process](#process)
- [Handoff Template](#handoff-template)

# Session Handoff

Capture current DS workflow state into `.planning/HANDOFF.md` so a fresh session can resume exactly where this one left off.

<EXTREMELY-IMPORTANT>
## The Iron Law of Handoff

**NO HANDOFF WITHOUT READING STATE FIRST. This is not negotiable.**

Before writing `.planning/HANDOFF.md`, you MUST:
1. READ `.planning/SPEC.md` (if exists) — understand the requirements
2. READ `.planning/PLAN.md` (if exists) — understand task breakdown and progress
3. READ `.planning/LEARNINGS.md` (if exists) — understand pipeline state and discoveries
4. ASSESS what is actually done vs. what remains
5. Only THEN write the handoff document

**About to write the handoff without having read the state files first → STOP (read them, then write).**
</EXTREMELY-IMPORTANT>

## Handoff Facts

- The next session knows NOTHING — it cannot reconstruct this session's decisions, rejected approaches, or pipeline discoveries from a task number. A handoff that says "continue task 3" forces full re-discovery.
- State files track the plan, not the session: LEARNINGS.md has facts; the handoff carries intent, decisions, dead ends, and next steps. Neither git history (WHAT changed, not WHY or WHAT'S NEXT) nor the state files substitute for it.
- A vague handoff costs the next session ~30 minutes of re-orientation — pipeline knowledge (row counts, data shape, join behavior) is expensive to re-derive and cheap to write down.

## Process

### Step 1: Read Current State

Read all available state files to understand where we are:

```
1. Read .planning/SPEC.md → requirements and success criteria
2. Read .planning/PLAN.md → task breakdown and approach
3. Read .planning/LEARNINGS.md → pipeline state, row counts, discoveries
4. Scan recent git log → what's been committed
5. Check for uncommitted changes → what's in-flight
```

**Run:**
```bash
# Check for uncommitted work
git status --short 2>/dev/null

# Recent commits in this session
git log --oneline -10 2>/dev/null
```

**Description:** ds-handoff: read current workflow and git state

### Step 2: Assess Progress

From the state files and git history, determine:
- **Current phase** (brainstorm / plan / implement / validate / review / verify)
- **Which tasks are complete** (from git history and PLAN.md)
- **Which task is in progress** (from uncommitted changes)
- **Pipeline state** (from LEARNINGS.md — row counts, data shape, latest stage)
- **Decisions made during this session** (from session context)
- **Blockers encountered** (from session context)

### Step 3: Write Handoff Document

Write `.planning/HANDOFF.md` using the template below. Every field is mandatory.

<EXTREMELY-IMPORTANT>
**The next session starts with ZERO context. If it's not in the handoff, it doesn't exist.**

Write as if briefing a colleague who has never seen this project. Include:
- The specific file you were editing and why
- The approach you chose and alternatives you rejected
- Any data surprises discovered during this session (unexpected nulls, row count changes, schema issues)
- The EXACT next action (not "continue working" — what specifically to do first)
</EXTREMELY-IMPORTANT>

### Step 4: Verify Handoff

**Checkpoint type:** human-verify (handoff completeness is machine-verifiable)

After writing, verify the handoff is complete:

```
1. IDENTIFY: .planning/HANDOFF.md exists
2. READ: Re-read the handoff document
3. VERIFY: Contains all sections (Current State, Completed Work, Remaining Work, Decisions, Next Action)
4. VERIFY: "Next Action" is specific enough to start immediately
5. VERIFY: Frontmatter phase/task numbers are accurate
```

**If any section is empty or vague, fix it before confirming handoff.**

## Handoff Template

```markdown
---
phase: [current phase number]
phase_name: [brainstorm|plan|implement|validate|review|verify]
task: [current task number, 0 if between tasks]
total_tasks: [N from PLAN.md]
status: paused
context_remaining: [approx % context left when handing off — lets a resuming session triage scope]
decisions_count: [N — number of entries in the Decisions Made section below]
last_updated: [ISO 8601]
---
# Session Handoff

## Current State
[Where exactly we are — the immediate context a new session needs.
Include: current file being edited, current pipeline stage,
current phase gate status. Be specific.]

## Completed Work
- [x] Task 1: [name] — Done ([brief note on what was done])
- [x] Task 2: [name] — Done
- [ ] Task 3: [name] — In progress ([what's done, what's not])

## Remaining Work
- Task 3: [what specifically remains]
- Task 4: [name] — Not started
- Task 5: [name] — Not started

## Decisions Made
- [Decision]: [what was decided and WHY]
- [Decision]: [what was decided and WHY]

## Master Datasets & Construction Diagram
<!-- For multi-exhibit projects. Lets the next session resume without re-deriving the data architecture. -->
- Master datasets and their grain/keys: [e.g. firm_quarter.parquet (gvkey, yearq) — BUILT; trade_file.parquet (cusip, trade_dt, seqnum) — NOT YET BUILT]
- Construction diagram location + currency: [e.g. docs/INVESTIGATION.md — current through Task 5; Task 6's filter not yet reflected]
- Exhibits still unmapped / unbuilt: [list, or "all exhibits map to a built master"]
- Parameter config location + open robustness checks: [e.g. src/config.py; MAX_TRADE_SIZE sensitivity {500K,2M} not yet run]

## Rejected Approaches
- [Approach]: [why it was rejected — saves the next session from re-exploring dead ends]

## Blockers
- [Blocker]: [status/workaround found]
- (none) — if no blockers

## Uncommitted Changes
- [file]: [what was changed and why]
- (none) — if all work is committed

## Next Action
Start with: [specific first action when resuming — not "continue task 3" but
"load data/processed/merged_panel.parquet and verify the winsorization in
src/clean.py produced expected row counts per LEARNINGS.md, then run DQ3
on the output"]
```

## Completion

After writing and verifying `.planning/HANDOFF.md`:

Announce: "Session handoff saved to .planning/HANDOFF.md. Next session will detect it automatically and offer to resume."

Report to user:
```
Handoff saved:
- Phase: [phase_name]
- Task: [N] of [total]
- Next action: [one-line summary]

Resume by starting /ds in this project — it will detect the handoff.
```
