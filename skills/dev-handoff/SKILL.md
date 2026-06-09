---
name: dev-handoff
description: "This skill should be used when the user asks to 'pause work', 'hand off session', 'save progress', 'create handoff', or when context is running low and work needs to continue in a new session."
user-invocable: false
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/dev-delegation-guard.py"
---

Announce: "Using dev-handoff to capture session state for clean resumption."

**Load shared enforcement:**

Read `${CLAUDE_SKILL_DIR}/../../references/constraints/dev-common-constraints.md`.

## Contents

- [The Iron Law of Handoff](#the-iron-law-of-handoff)
- [Handoff Facts](#handoff-facts)
- [Process](#process)
- [Handoff Template](#handoff-template)

# Session Handoff

Capture current workflow state into `.planning/HANDOFF.md` so a fresh session can resume exactly where this one left off. Adapted from GSD's pause-work pattern.

<EXTREMELY-IMPORTANT>
## The Iron Law of Handoff

**NO HANDOFF WITHOUT READING CURRENT STATE FIRST. This is not negotiable.**

Before writing `.planning/HANDOFF.md`, you MUST:
1. READ `.planning/SPEC.md` (if exists) — understand the requirements
2. READ `.planning/PLAN.md` (if exists) — understand task breakdown and progress
3. READ `.planning/ACTIVE_WORKFLOW.md` (if exists) — understand current phase
4. ASSESS what is actually done vs. what remains
5. Only THEN write the handoff document

**If you catch yourself writing a handoff without reading state files first, STOP.**
</EXTREMELY-IMPORTANT>

## Handoff Facts

- State files (SPEC.md, PLAN.md, ACTIVE_WORKFLOW.md) track the *plan*, not the *session*: decisions made, approaches rejected, dead ends explored, and in-flight context exist only in this conversation. A handoff that defers to the state files asserts coverage they do not have — an unverified claim presented as fact.
- Git history shows WHAT changed, not WHY or WHAT'S NEXT. "The next session can figure it out from git" hands them an archaeology task instead of a briefing — counterproductive on its own terms.
- A vague handoff ("continue task 3") costs the next session ~30 minutes of re-orientation; lost context costs roughly 10x the time a thorough handoff takes to write. Trimming the handoff to save time is anti-efficient and anti-helpful — the next session starts slower than a fresh start.

## Process

### Step 1: Read Current State

Read all available state files to understand where we are:

```
1. Read .planning/ACTIVE_WORKFLOW.md → current phase, workflow type
2. Read .planning/SPEC.md → requirements and success criteria
3. Read .planning/PLAN.md → task breakdown and approach
4. Scan recent git log → what's been committed
5. Check for uncommitted changes → what's in-flight
```

**Run:**
```bash
# Check workflow state
cat .planning/ACTIVE_WORKFLOW.md 2>/dev/null || echo "No active workflow"

# Check for uncommitted work
git status --short 2>/dev/null

# Recent commits in this session
git log --oneline -10 2>/dev/null
```

**Description:** dev-handoff: read current workflow and git state

### Step 2: Assess Progress

From the state files and git history, determine:
- **Current phase** (from ACTIVE_WORKFLOW.md)
- **Which tasks are complete** (from git history and PLAN.md)
- **Which task is in progress** (from uncommitted changes)
- **Decisions made during this session** (from session context)
- **Blockers encountered** (from session context)

### Step 3: Write Handoff Document

Write `.planning/HANDOFF.md` using the template below. Every field is mandatory.

<EXTREMELY-IMPORTANT>
**The next session starts with ZERO context. If it's not in the handoff, it doesn't exist.**

Write as if briefing a colleague who has never seen this project. Include:
- The specific file you were editing and why
- The approach you chose and alternatives you rejected
- Any gotchas or surprises discovered during this session
- The EXACT next action (not "continue working" — what specifically to do first)
</EXTREMELY-IMPORTANT>

### Step 4: Verify Handoff

After writing, verify the handoff is complete:

```
1. IDENTIFY: .planning/HANDOFF.md exists
2. READ: Re-read the handoff document
3. VERIFY: Contains all sections (Current State, Completed Work, Remaining Work, Decisions, Next Action)
4. VERIFY: "Next Action" is specific enough to start immediately
5. VERIFY: Frontmatter phase/task match ACTIVE_WORKFLOW.md
```

**If any section is empty or vague, fix it before confirming handoff.**

## Handoff Template

```markdown
---
phase: [current phase number]
phase_name: [brainstorm|explore|clarify|design|implement|review|verify]
task: [current task number, 0 if between tasks]
total_tasks: [N from PLAN.md, 0 if no plan yet]
status: paused
last_updated: [ISO 8601 timestamp]
---
# Session Handoff

## Current State
[Where exactly we are — the immediate context a new session needs.
Include: current file being edited, current test being written,
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
"run pytest tests/test_auth.py to verify the token refresh logic, then implement
the error handling in src/auth.py:45"]
```

## Completion

**Checkpoint type:** human-verify (handoff completeness is machine-verifiable)

After writing and verifying `.planning/HANDOFF.md`:

Announce: "Session handoff saved to .planning/HANDOFF.md. Next session will detect it automatically and offer to resume."

Report to user:
```
Handoff saved:
- Phase: [phase_name]
- Task: [N] of [total]
- Next action: [one-line summary]

Resume by starting /dev in this project — it will detect the handoff.
```
