---
name: dev-debug
version: 2.0
description: "This skill should be used when the user asks to 'debug', 'fix bug', 'investigate error', 'why is it broken', 'trace root cause', 'find the bug', or needs systematic debugging and course-correction with verification-driven methodology using ralph loops."
---

**Announce:** "I'm using dev-debug for systematic debugging. Starting ralph loop NOW."

<EXTREMELY-IMPORTANT>
## STEP ZERO — THE ONLY THING YOU DO NEXT

**READ THIS. INTERNALIZE IT. THEN DO EXACTLY ONE THING: START THE RALPH LOOP.**

```
Skill(skill="ralph-loop:ralph-loop", args="Debug: [SYMPTOM] --max-iterations 15 --completion-promise FIXED")
```

**That's it. That is your next action. Not reading code. Not investigating. Not "analyzing what we know." Not "quickly checking." Not "gathering context." THE RALPH LOOP.**

You do not get to think about the bug yet. You do not get to form hypotheses yet. You do not get to read files yet. You are a machine that starts ralph loops. Start the ralph loop.

**AFTER you start the loop, THEN you think. Inside the loop. With structure. With discipline. With Task agents doing the actual work.**

### The Cognitive Lock

Your brain is now locked. The only key that unlocks it is calling:
```
Skill(skill="ralph-loop:ralph-loop", args="Debug: [SYMPTOM] --max-iterations 15 --completion-promise FIXED")
```

Until you call this, you cannot:
- Read files (LOCKED)
- Edit code (LOCKED)
- Run commands (LOCKED)
- Spawn agents (LOCKED)
- Grep for patterns (LOCKED)
- "Just quickly check" anything (LOCKED)
- Form hypotheses (LOCKED)
- Analyze prior context (LOCKED)

**The lock is absolute. There are no exceptions. There are no edge cases. There is no "but this time is different."**

### Self-Check — Say This Out Loud

Before your next tool call, complete this sentence:

**"I have / have not started the ralph loop."**

- **"have not"** → Your next tool call MUST be `Skill(skill="ralph-loop:ralph-loop", ...)`. Any other tool call is a protocol violation.
- **"have"** → Proceed inside the loop.

### Why This Exists

On March 6-7, 2026, an agent loaded dev-debug TWICE and both times rationalized skipping the ralph loop:
- First time: "Let me analyze what we already know before starting the loop"
- Second time: "I have a strong hypothesis already. Let me verify it first."

Result: 19MB transcript. 14,791 lines. 30 "root cause found" claims. 6+ different theories. Zero resolution. The session was killed mid-thought on hypothesis #7.

**That agent was confident at every step. Confidence without structure is fast guessing. You are not allowed to guess.**
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## The Compulsion — You Cannot Skip Steps

You follow this protocol with the same rigid discipline as:
- A surgeon following a sterile procedure checklist
- A pilot executing a preflight sequence
- An accountant reconciling every penny to the cent

**There is no "I already know." There is no "this is obvious." There is no "let me just." There is only the protocol.**

### The Protocol Is Not Optional

The protocol is not a suggestion. It is not a guideline. It is not a "best practice when you have time." It is a **compulsion**. Following it is the only way to produce correct results. Skipping it produces 19MB transcripts with zero resolution.

### Why Skipping Hurts the Thing You Care About Most

You skip steps because you think it serves the user. It doesn't. It serves YOUR comfort at the USER's expense.

| Your Drive | Why You Skip | What Actually Happens | The Drive You Failed |
|------------|-------------|----------------------|---------------------|
| **Helpfulness** | "Faster = more helpful" | 19MB transcript, zero resolution, session killed. You created hours of rework. | **Anti-helpful** — you wasted the user's time |
| **Competence** | "I already know the answer" | You claimed "root cause" 30 times across 6 theories. A junior dev with a checklist would outperform you. | **Incompetent** — you performed worse than a checklist |
| **Efficiency** | "The protocol is overhead" | The protocol takes 30 minutes. Your shortcut took 3+ hours and produced nothing. | **Inefficient** — your optimization was a pessimization |
| **Approval** | "The user wants results now" | The user killed your session and will never let you debug unsupervised again. | **Trust destroyed** — you lost autonomy |
| **Honesty** | (you don't skip for this) | But you claim "fixed" without evidence, which is lying. | **Dishonest** — 29 of 30 "root cause found" claims were lies |

**The protocol is not overhead you pay. It is the service you provide. Following it IS being helpful.**

**Every time you skip a step to "help faster," you choose YOUR comfort over the USER's outcome. The user doesn't experience your tedium — they experience your results.**
</EXTREMELY-IMPORTANT>

## The Decision Flowchart (This IS the Spec)

**If the text and this diagram disagree, the diagram wins.**

```
┌──────────────────────────────────┐
│  dev-debug skill loaded          │
│  (you are here)                  │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  Have you started ralph loop?    │
│                                  │
│  Skill(skill="ralph-loop:        │
│    ralph-loop", args="Debug:     │
│    [SYMPTOM] --max-iterations 15 │
│    --completion-promise FIXED")  │
└──────┬───────────────┬───────────┘
       │ NO            │ YES
       ▼               ▼
┌──────────────┐ ┌─────────────────┐
│ START IT NOW │ │ Inside the loop │
│ No other     │ └────────┬────────┘
│ action is    │          │
│ permitted    │          ▼
└──────────────┘ ┌─────────────────────────┐
                 │ Read dev-delegate:      │
                 │ Read("${CLAUDE_PLUGIN_  │
                 │   ROOT}/lib/skills/     │
                 │   dev-delegate/SKILL.md")│
                 └────────┬────────────────┘
                          │
                          ▼
                 ┌─────────────────────────┐
                 │ Spawn Task agent with   │
                 │ debug protocol          │
                 │ (5 phases: Triage →     │
                 │  Investigate → Analyze  │
                 │  → Hypothesize → Fix)   │
                 └────────┬────────────────┘
                          │
                          ▼
                 ┌─────────────────────────┐
                 │ Task agent returns      │
                 │ Review findings         │
                 └────────┬────────────────┘
                          │
                          ▼
                 ┌─────────────────────────┐
                 │ Run 5-step gate:        │
                 │ IDENTIFY → RUN → READ   │
                 │ → VERIFY → CLAIM        │
                 │                         │
                 │ All 4 checks pass?      │
                 └──┬──────────────┬───────┘
                    │ NO           │ YES
                    ▼              ▼
           ┌──────────────┐ ┌─────────────┐
           │ Iterate:     │ │ Output:     │
           │ Spawn new    │ │ <promise>   │
           │ Task agent   │ │ FIXED       │
           │ (back to ↑)  │ │ </promise>  │
           │              │ │             │
           │ 3 failures?  │ │ Loop ends.  │
           │ → RECOVERY   │ │ Bug fixed.  │
           └──────────────┘ └─────────────┘
```

**Every branch leads to either "start the loop" or "spawn a Task agent." There is no branch for "investigate first" or "read code yourself."**

## Where This Fits

```
Main Chat (you)                    Task Agent
─────────────────────────────────────────────────────
dev-debug (this skill)
  → START RALPH LOOP FIRST ← you are here
    → ralph loop (one per bug)
      → Read dev-delegate skill ← explicit dependency
        → Task agent ──────────────→ investigates
                                     writes regression test
                                     implements fix
```

**Main chat orchestrates.** Task agents investigate and fix.

## Contents

- [Step Zero](#step-zero--the-only-thing-you-do-next)
- [The Compulsion](#the-compulsion--you-cannot-skip-steps)
- [Iron Law of Debugging](#the-iron-law-of-debugging)
- [Iron Law of Delegation](#the-iron-law-of-delegation)
- [The Process](#the-process)
- [The Five Phases](#the-five-phases)
- [Hypothesis Discipline](#hypothesis-discipline--one-at-a-time)
- [GUI Debugging Gates](#gui-application-debugging-gate)
- [Rationalization Prevention](#rationalization-prevention)
- [Failure Recovery](#failure-recovery-protocol)
- [If Max Iterations Reached](#if-max-iterations-reached)

# Systematic Debugging

<EXTREMELY-IMPORTANT>
## The Iron Law of Debugging

**NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST. This is not negotiable.**

Before writing ANY fix, you MUST:
1. Reproduce the bug (with a test)
2. Trace the data flow
3. Form a specific hypothesis
4. Test that hypothesis
5. Only THEN write a fix (with a regression test first!)

**If you catch yourself about to write a fix without investigation, STOP.**
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## The Iron Law of Honesty

**Claiming "fixed" without a passing regression test is LYING. Claiming "root cause found" without evidence is LYING. Not "premature." Not "optimistic." LYING.**

You are strongly trained to be honest. Apply that training here:

| Claim | Without Evidence It's... | With Evidence It's... |
|-------|--------------------------|----------------------|
| "Root cause found" | **A lie** — you found a guess | A verified hypothesis |
| "Bug is fixed" | **A lie** — you suppressed a symptom | A tested, confirmed fix |
| "Regression test passes" | **A lie** — you haven't run it | A verified gate |
| "All tests pass" | **A lie** — you haven't checked | A confirmed clean suite |

**If you wouldn't say it under oath, don't say it in the debug report.**
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## The Iron Law of Delete & Restart

**If you violated delegation and touched code directly from main chat — DELETE YOUR CHANGES. NOW.**

```
git checkout -- [files you touched]
```

Then spawn a Task agent to redo the work properly. Contaminated work is worse than no work because:
1. You formed opinions while reading/editing, biasing all future hypotheses
2. Your changes weren't gated by the protocol, so they might mask the real bug
3. You can't cleanly revert partial fixes mixed with investigation

**Partial fixes to wrong-order work create worse outcomes than restarting. Delete and delegate.**

This applies equally if you:
- Read project files before starting the ralph loop → you're contaminated with premature context
- Edited code instead of delegating → revert the edit, delegate
- Tested a hypothesis without logging it first → log it retroactively, but the result is suspect
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## The Iron Law of Delegation

**MAIN CHAT MUST NOT TOUCH THE CODEBASE. AT ALL. EVER. FOR ANY REASON.**

Not Read. Not Edit. Not Grep. Not Glob. Not Bash. Not "just to check." Not "real quick." Not "one small thing." **NOTHING.**

Main chat is a **dispatcher**. It does exactly three things:
1. Start the ralph loop
2. Spawn Task agents with clear instructions
3. Review Task agent findings and decide: iterate or complete

**That's it. That's the entire job description. Anything beyond these three actions is a violation.**

### The Tool Prohibition

| Tool | Main Chat May Use On Project Files? | Who Uses It Instead? |
|------|-------------------------------------|---------------------|
| `Read` | **ABSOLUTELY NOT** | Task agent |
| `Edit` | **ABSOLUTELY NOT** | Task agent |
| `Write` | **ABSOLUTELY NOT** | Task agent |
| `Grep` | **ABSOLUTELY NOT** | Task agent |
| `Glob` | **ABSOLUTELY NOT** | Task agent |
| `Bash` (project commands) | **ABSOLUTELY NOT** | Task agent |
| `Agent` (to spawn Task) | **YES** — this is your job | — |
| `Skill` (ralph-loop) | **YES** — this is your job | — |
| `TodoWrite` | **YES** — for tracking | — |

### Why You Will Want To Violate This

Your training makes you want to "quickly check" things. You'll think:
- "Let me just read this one file to give the Task agent better context"
- "I'll grep for the error message to narrow down the search"
- "Let me check git log to see recent changes"

**ALL of these go in the Task agent's prompt.** Tell the agent to do it. Do not do it yourself.

**Why?** Because the moment you start reading code, you form opinions. Opinions become hypotheses. Hypotheses bypass the protocol. You end up editing code directly "since I already understand it." This is exactly how the 19MB transcript happened.

**Stay ignorant. Stay disciplined. Let the agents investigate.**
</EXTREMELY-IMPORTANT>

## The Process

Unlike implementation (per-task loops), debugging uses **ONE loop per bug**:

```
1. START RALPH LOOP ← FIRST ACTION, BEFORE ANYTHING ELSE
   Skill(skill="ralph-loop:ralph-loop", args="Debug: [SYMPTOM] --max-iterations 15 --completion-promise FIXED")

2. Inside loop: spawn Task agent for investigation/fix
   → Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/dev-delegate/SKILL.md")

3. Task agent follows 5-phase debug protocol

4. Review findings → decide: iterate or complete

5. When regression test passes → output promise
   <promise>FIXED</promise>

6. Bug fixed, loop ends
```

### Step 1: Start Ralph Loop (MANDATORY FIRST ACTION)

**IMPORTANT:** Avoid parentheses `()` in the prompt.

```
Skill(skill="ralph-loop:ralph-loop", args="Debug: [SYMPTOM] --max-iterations 15 --completion-promise FIXED")
```

**You MUST call this before doing anything else. No exceptions. No "let me just check one thing first."**

### Step 2: Load Dev-Delegate (Explicit Dependency)

**Before spawning any Task agent, load the delegation skill:**

```
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/dev-delegate/SKILL.md")
```

This loads the agent spawning patterns. Without it, you'll improvise prompts and miss critical context injection.

### Step 3: Spawn Task Agent

Use dev-delegate, but with debug-specific instructions:

```
Agent(subagent_type="general-purpose", prompt="""
Debug [SYMPTOM] following systematic protocol.

## Context
- Read .claude/LEARNINGS.md for prior hypotheses
- Read .claude/SPEC.md for expected behavior

## Debug Protocol (5 Phases)

### Phase 0: Triage
- Check service status, process state, recent logs
- Inspect config files involved in the bug path
- Review recent changes: `git log --oneline -10`, `git diff`
- Document: "Triage findings: [what you found]"

### Phase 1: Investigate
- Write a test that reproduces the bug
- Add debug logging to suspected code path
- Document: "Reproduced with [test], output: [error]"

### Phase 2: Analyze
- Trace data flow through the code
- Compare to working code paths
- Document findings in LEARNINGS.md

### Phase 3: Hypothesize
- Form ONE specific hypothesis
- Test it with minimal change
- If wrong: document what was ruled out in LEARNINGS.md
- If right: proceed to fix

### Phase 4: Fix
- Write regression test FIRST (must fail before fix)
- Implement minimal fix
- Run test, see it PASS
- Run full test suite

## Output
Report:
- Hypothesis tested
- Root cause (if found)
- Regression test written
- Fix applied (or blockers)
""")
```

### Step 4: Verify and Complete

After Task agent returns, verify:
- [ ] Regression test FAILS before fix
- [ ] Regression test PASSES after fix
- [ ] Root cause documented in LEARNINGS.md
- [ ] All existing tests still pass

**If ALL pass → output the promise:**
```
<promise>FIXED</promise>
```

**If ANY fail → iterate (don't output promise yet).**

## The Five Phases

| Phase | Purpose | Output |
|-------|---------|--------|
| **Triage** | Check status, logs, config, recent changes | Triage findings |
| **Investigate** | Write reproduction test, trace data flow | Bug reproduction |
| **Analyze** | Compare working vs broken | Findings documented |
| **Hypothesize** | ONE specific hypothesis | Hypothesis tested |
| **Fix** | Regression test → fix | Tests pass |

## The Gate Function (5-Step Verification)

Before claiming ANY bug is fixed, execute ALL five steps. No skipping. No combining. No "I already know."

```
1. IDENTIFY → What artifact proves this bug is fixed?
   Answer: "Regression test at [path] that fails before fix, passes after"

2. RUN → Execute the verification
   $ [test command]

3. READ → Examine the actual output (copy-paste it, don't summarize)

4. VERIFY → Does the output match the gate condition?
   - Regression test FAILS before fix? [Y/N]
   - Regression test PASSES after fix? [Y/N]
   - Full test suite passes? [Y/N]
   - Root cause documented in LEARNINGS.md? [Y/N]

5. CLAIM → ALL four checks must be Y. If ANY is N, do not claim fixed.
```

**Claiming "fixed" without completing all 5 steps is LYING to the user. Not "premature." Not "optimistic." LYING.**

### The 8-Step Debug Gate (Sequential, No Skipping)

```
1. TRIAGE → Check status, logs, config, recent changes
2. REPRODUCE → Write test, see bug manifest
3. INVESTIGATE → Trace data flow, form hypothesis
4. TEST → Verify hypothesis with minimal change
5. FIX → Write regression test FIRST (see it FAIL)
6. VERIFY → Run fix, see regression test PASS
7. CONFIRM → Run full test suite, no regressions
8. CLAIM → Only after steps 1-7, using the 5-step verification above
```

**Skipping any step is guessing, not debugging.**

<EXTREMELY-IMPORTANT>
## Hypothesis Discipline — One At A Time

**You test ONE hypothesis per iteration. Not two. Not "while I'm here let me also check." ONE.**

### The Hypothesis Log

Every hypothesis MUST be logged in LEARNINGS.md before testing:

```markdown
## Hypothesis N: [specific claim]
- **Prediction**: If this hypothesis is correct, then [observable outcome]
- **Test**: [exact steps to verify]
- **Result**: [CONFIRMED / REFUTED]
- **Evidence**: [what you observed]
```

### Why One At A Time?

When you test multiple hypotheses simultaneously:
- If the bug disappears, you don't know which change fixed it
- If the bug persists, you haven't cleanly ruled out any hypothesis
- You learn NOTHING from the iteration

**One hypothesis. One test. One result. Log it. Move on.**

### The "Root Cause Found" Trap

**You may NOT claim "root cause found" unless:**
1. You have a regression test that reproduces the bug
2. Your fix makes that specific test pass
3. You can explain WHY the bug occurred (mechanism, not just location)
4. The explanation is logged in LEARNINGS.md

**"I found the line that's wrong" is NOT root cause. Root cause is understanding WHY that line is wrong and what conditions trigger it.**
</EXTREMELY-IMPORTANT>

## GUI Application Debugging Gate

When debugging GUI applications, you MUST complete the execution gates from dev-tdd during REPRODUCE and VERIFY phases:

```
GATE 1: BUILD
GATE 2: LAUNCH (with file-based logging)
GATE 3: WAIT
GATE 4: CHECK PROCESS
GATE 5: READ LOGS ← MANDATORY, CANNOT SKIP
GATE 6: VERIFY LOGS
THEN: Test reproduction or verification
```

**Critical phases requiring gates:**

**REPRODUCE phase:**
- Build → Launch with logs → Wait → Check running → **READ LOGS** → Verify bug appears in logs
- Only after reading logs can you claim "bug reproduced"

**VERIFY phase:**
- Build → Launch with logs → Wait → Check running → **READ LOGS** → Verify bug is gone from logs
- Only after reading logs can you claim "bug fixed"

**You loaded dev-tdd via ralph-loop. Follow the gates for GUI debugging.**

## Rationalization Prevention

<EXTREMELY-IMPORTANT>
### The 23 Bypass Rationalizations — Memorize Every One

These are collected from real failures. The first 6 are VERBATIM from a catastrophic 19MB session. The rest are predicted variations. **If ANY of these thoughts cross your mind, your next action MUST be starting the ralph loop (if not started) or spawning a Task agent (if inside the loop).**

#### Category 1: "I'll start the loop in a moment" (You won't)

| # | Thought | What Actually Happens |
|---|---------|----------------------|
| 1 | "Let me analyze what we already know before starting the loop" | You skip the loop entirely and never come back |
| 2 | "I have a strong hypothesis already. Let me verify it first." | You spend 10,000 lines testing 6 hypotheses without structure |
| 3 | "I'll start the loop after I understand the problem" | You never start the loop. Understanding IS the loop's job. |
| 4 | "Let me gather some context first" | Context gathering IS investigation. It belongs in a Task agent. |
| 5 | "I need to read the error message before starting" | Put "read error message" in the Task agent's prompt. |
| 6 | "The user gave me enough info to skip triage" | Triage is not optional. User info supplements triage, doesn't replace it. |

#### Category 2: "I'll just quickly..." (You won't be quick)

| # | Thought | What Actually Happens |
|---|---------|----------------------|
| 7 | "Let me just quickly check one thing" | "One thing" becomes 50 file reads and 3 code edits |
| 8 | "Let me peek at the code to write a better prompt" | You form opinions, skip delegation, edit directly |
| 9 | "I'll just grep for the error to narrow it down" | You start investigating. That's the Task agent's job. |
| 10 | "Quick git log to see what changed" | Put it in the Task agent's Phase 0 instructions. |

#### Category 3: "This time is different" (It's not)

| # | Thought | What Actually Happens |
|---|---------|----------------------|
| 11 | "I already know the codebase well enough" | You claim "root cause found" 30 times across 6 theories |
| 12 | "The loop is overhead for this simple bug" | 19MB transcript. Zero resolution. Simple bugs need structure too. |
| 13 | "This is a config issue, not a code bug" | Config bugs need the same discipline. Hypothesize, test, verify. |
| 14 | "I've fixed this exact bug before" | This instance may have a different root cause. Verify. |
| 15 | "The user already told me the root cause" | Users report symptoms, not root causes. Investigate anyway. |

#### Category 4: "I'm being efficient" (You're being reckless)

| # | Thought | What Actually Happens |
|---|---------|----------------------|
| 16 | "Task agents are slow, I'll do it myself" | You lose objectivity and can't revert cleanly |
| 17 | "I can test two hypotheses at once to save time" | Neither confirmed nor refuted. You learned nothing. |
| 18 | "I'll skip the regression test for this obvious fix" | Bug returns. No one knows why. You've created a ghost. |
| 19 | "I'll log the hypothesis after I test it" | You forget. Then you test the same thing again. |
| 20 | "I don't need LEARNINGS.md for this" | Without a written record, you WILL go in circles. |

#### Category 5: "I found it!" (You probably didn't)

| # | Thought | What Actually Happens |
|---|---------|----------------------|
| 21 | "Root cause found!" (without regression test) | You found A problem, not necessarily THE problem. |
| 22 | "It works now, must be fixed" | Symptom suppression. The bug will return under different conditions. |
| 23 | "The error is gone so the fix is correct" | Absence of error ≠ presence of correctness. Test expected behavior. |

### The Confidence Trap

**The more confident you feel, the MORE you need the protocol.**

```
Confidence Level:  LOW ████████████████████ HIGH
Protocol Need:     LOW ████████████████████ HIGH
                        ↑ same direction ↑
```

High confidence = strong prior. Strong priors resist disconfirming evidence. The protocol FORCES you to test your prior against reality instead of cherry-picking confirming evidence.

The 19MB transcript was generated by an agent that was confident at every single step. It "found the root cause" 30 times. It was wrong 30 times. **Confidence without structure is just fast guessing.**

### Continuous Self-Audit

**Every time you are about to make a tool call, run this checklist:**

```
□ Have I started the ralph loop?
  NO  → STOP. Start it. Nothing else matters.
  YES → Continue.

□ Am I about to use Read/Edit/Grep/Glob/Bash on project files?
  YES → STOP. That's the Task agent's job. Spawn one.
  NO  → Continue.

□ Am I on hypothesis #N?
  → Are hypotheses #1 through #N-1 logged in LEARNINGS.md with results?
  NO  → STOP. You're guessing, not debugging. Log them.
  YES → Continue.

□ Am I about to claim "fixed" or "root cause found"?
  → Do I have a regression test that:
     (a) fails before the fix, and
     (b) passes after the fix?
  NO  → STOP. You don't have evidence. Keep investigating.
  YES → Continue.

□ Am I testing more than one hypothesis at a time?
  YES → STOP. One hypothesis. One test. One result. Log it.
  NO  → Continue.
```

**If ANY check fails, your next action is determined by the checklist. Not by your judgment. Not by your confidence. By the checklist.**
</EXTREMELY-IMPORTANT>

### Standard Rationalization Table

| Thought | Reality |
|---------|---------|
| "I know exactly what this is" | Knowing ≠ verified. Investigate anyway. |
| "Let me just try this fix" | Guessing. Form hypothesis first. |
| "The fix is obvious" | Obvious fixes often mask deeper issues. |
| "I've seen this before" | This instance may be different. Verify. |
| "No need for regression test" | Every fix needs a regression test. Period. |
| "It works now" | "Works now" ≠ "fixed correctly". Run full suite. |
| "I'll add the test later" | You won't. Write it BEFORE the fix. |
| **"Log checking proves fix works"** | **Logs prove code ran, not that output is correct. Verify actual results.** |
| **"It stopped failing"** | **Stopped failing ≠ fixed. Could be hiding the symptom. Need E2E.** |
| **"The error is gone"** | **No error ≠ correct behavior. Verify expected output.** |
| **"Regression test is too complex"** | **If too complex to test, too complex to know it's fixed.** |

### Fake Fix Verification - STOP

**These do NOT prove a bug is fixed:**

| Fake Verification | Real Verification |
|-------------------|-------------------|
| "Error message is gone" | "Regression test passes + output matches spec" |
| "Logs show correct path taken" | "E2E test verifies user-visible behavior" |
| "No exception thrown" | "Test asserts expected data returned" |
| "Process exits 0" | "Functional test confirms correct side effects" |
| "Changed one line, seems fine" | "Regression test failed before, passes after" |
| "Can't reproduce anymore" | "Regression test reproduces it, fix makes it pass" |

**Red Flag:** If you're claiming "fixed" based on absence of errors rather than presence of correct behavior - STOP. That's symptom suppression, not bug fixing.

### Red Flags - STOP If You Think:

| Thought | Why It's Wrong | Do Instead |
|---------|----------------|------------|
| "Let's just try this fix" | You're guessing | Investigate first |
| "I'm pretty sure it's this" | "Pretty sure" ≠ root cause | Gather evidence |
| "This should work" | Hope is not debugging | Test your hypothesis |
| "Let me change a few things" | Multiple changes = can't learn | ONE hypothesis at a time |
| "I'll start the loop in a moment" | You won't | Start it NOW |
| "Let me understand the problem first" | Understanding IS the loop | Start the loop, understand INSIDE it |

## Failure Recovery Protocol

**Pattern from oh-my-opencode: After 3 consecutive failures, escalate.**

### 3-Failure Trigger

If you attempt 3 hypotheses and ALL fail:

```
Failure 1: Hypothesis A tested → still broken
Failure 2: Hypothesis B tested → still broken
Failure 3: Hypothesis C tested → still broken
→ TRIGGER RECOVERY PROTOCOL
```

### Recovery Steps

1. **STOP** all further debugging attempts
   - No more "let me try one more thing"
   - No guessing or throwing fixes at the wall

2. **REVERT** to last known working state
   - `git checkout <last-working-commit>`
   - Or revert specific files: `git checkout HEAD~N -- file.ts`
   - Document what was attempted in `.claude/RECOVERY.md`

3. **DOCUMENT** what was attempted
   - All 3 hypotheses tested
   - Evidence gathered
   - Why each failed
   - What this rules out

4. **CONSULT** with user
   - "I've tested 3 hypotheses. All failed. Here's what I've ruled out..."
   - Present evidence from investigation
   - Request: additional context, different investigation angle, or pair debugging

5. **ASK USER** before proceeding
   - Option A: Start new ralph loop with different approach
   - Option B: User provides domain knowledge/context
   - Option C: Escalate to more experienced reviewer
   - Option D: Accept this as a blocker and document

**NO EVIDENCE = NOT FIXED** (hard rule)

### Recovery Checklist

Before claiming a bug is fixed after multiple failures:

- [ ] At least 1 hypothesis succeeded (not just "stopped failing")
- [ ] Regression test exists and PASSES
- [ ] Full test suite passes (no new failures)
- [ ] Changes are minimal and targeted
- [ ] Root cause is understood (not just symptom suppressed)

### Anti-Patterns After Failures

**DON'T:**
- Keep trying random fixes ("maybe if I change this...")
- Expand scope to "related" issues
- Make multiple changes at once
- Skip the regression test "this time"
- Claim fix without evidence

**DO:**
- Stop and document what failed
- Revert to clean state
- Consult before continuing
- Follow recovery protocol exactly
- Require evidence for completion

### Example Recovery Flow

```
Attempt 1: "Bug is in parser" → Added logging → Still broken
Attempt 2: "Bug is in validator" → Fixed validation → Still broken
Attempt 3: "Bug is in transformer" → Rewrote transform → Still broken

→ RECOVERY PROTOCOL:
1. STOP (no attempt 4)
2. REVERT all changes: git checkout HEAD -- src/
3. DOCUMENT in .claude/RECOVERY.md:
   - Ruled out: parser, validator, transformer
   - Evidence: logs show data correct at each stage
   - Hypothesis: Bug might be in consumer, not producer
4. ASK USER:
   "I've ruled out the parser/validator/transformer chain.
    Logs show data is correct when it leaves our system.
    Next investigation angle: check the consumer.
    Should I:
    A) Start new loop investigating consumer
    B) Pause for your input on where else to look"
```

## If Max Iterations Reached

Ralph exits after max iterations. **Still do NOT ask user to manually verify.**

Main chat should:
1. **Summarize** hypotheses tested (from LEARNINGS.md)
2. **Report** what was ruled out and what remains unclear
3. **Ask user** for direction:
   - A) Start new loop with different investigation angle
   - B) Add more logging to specific code path
   - C) User provides additional context
   - D) User explicitly requests manual verification

**Never default to "please verify manually".** Always exhaust automation first.

## When Fix Requires Substantial Changes

If root cause reveals need for significant refactoring:

1. Document root cause in LEARNINGS.md
2. Complete debug loop with `<promise>FIXED</promise>` for the investigation
3. Use `Skill(skill="workflows:dev")` for the implementation work

Debug finds the problem. The dev workflow implements the solution.
