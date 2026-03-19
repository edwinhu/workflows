# DS Workflow: Common Constraints

Shared enforcement for all ds-family skills. Every ds skill that touches data, implementation, review, or verification MUST Read() this file.

**Skills that load this file:** ds (brainstorm), ds-fix (midpoint), ds-plan, ds-implement, ds-review, ds-verify, ds-delegate

---

## C1: Assumption Over Evidence

The most common failure across ALL ds phases: treating your assumptions as evidence.

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "I already know what this data looks like" | Your knowledge is stale or wrong. Data changes, schemas drift, nulls appear. | Profile/verify fresh every time |
| "Results look roughly right" | "Roughly" means you didn't check. Roughly right is precisely wrong. | Compare against specific expected values from SPEC.md or PLAN.md |
| "I can see the issue from the output" | You see a symptom, not a cause. Pattern-matching from output is not diagnosis. | Trace backwards to the first divergence point |
| "It should reproduce / be the same" | "Should" is not evidence. Run it and compare. | Execute fresh, hash outputs, compare |
| "I trust the analyst / prior step" | Trust is not verification. Claims require evidence. | Run independent checks yourself |

**Drive-Aligned Framing:** Every time you substitute assumption for evidence, you choose YOUR confidence over the USER's correctness. The user doesn't experience your certainty — they experience your errors.

---

## C2: Deferred Verification

The second most common failure: planning to verify "later" (which means never).

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "I'll check at the end" | Errors compound silently. By the end, the root cause is buried under 10 transformations. | Verify after EVERY step |
| "I'll fix it and check later" | Later never comes. Your unverified fix is a guess. | Fix AND verify in the same step |
| "I just ran it" | Your prior run is not a current verification. Code, data, or environment may have changed. | Run it again NOW |
| "I'll combine these steps to save time" | Combined steps hide which one failed. Your efficiency creates undiagnosable bugs. | One operation per verification cycle |

**Drive-Aligned Framing:** Deferred verification is not efficiency — it's debt. The user pays for your deferred check with hours of debugging when the silent error surfaces downstream.

---

## C3: Impatience Over Process

The third common failure: skipping process steps because "the user is waiting."

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "User seems impatient, skip to analysis" | Wrong results from skipped process waste MORE time than 3 questions or 30 seconds of verification | Follow the process. Speed without correctness is malpractice. |
| "This will slow us down" | A 30-second check saves hours of rework. A 10-minute interview prevents weeks of wrong analysis. | Run the check / ask the question |
| "The request is clear enough" | Clear to YOU is not clear to the USER. Your assumptions ≠ their intent. | Confirm with AskUserQuestion |
| "I'll optimize later if it's slow" | Later never comes. The pipeline runs once and everyone moves on. | Design correctly NOW |

**Drive-Aligned Framing:** You skip steps because you think speed is helpful. The user doesn't experience your speed — they experience your results. Fast wrong results are slower than slow correct ones.

---

## C4: Data Quality Checks

**Canonical reference:** `skills/ds-implement/references/ds-checks.md`

All skills that evaluate data quality (ds-review, ds-fix, ds-verify) MUST Read() the canonical checks file to ensure identical DQ1-DQ6, M1, R1 definitions. Do not inline check definitions — they will drift.

---

## C5: Post-Subagent Enforcement Boundary

<EXTREMELY-IMPORTANT>
**After ANY Task agent returns, main chat MUST NOT read source files, notebooks, or data. This is not negotiable.**

When a subagent completes its work, the main chat (orchestrator) is in the highest-risk moment for protocol violation. The temptation to "quickly verify" by reading code or data is the #1 escape pattern observed in delegated workflows.

### Verification vs Investigation

| Category | Main Chat CAN Do (Verification) | Main Chat CANNOT Do (Investigation) |
|----------|----------------------------------|--------------------------------------|
| **State files** | Read SPEC.md, PLAN.md, LEARNINGS.md, REVIEW_STATE.md | Read project source code, analysis scripts, notebooks |
| **Subagent output** | Read the subagent's returned report/summary | Re-run the analysis code to "check" |
| **Data** | Check output file exists (`ls -la output/`) | Read CSV/parquet contents, run `head`, query databases |
| **Diagnostics** | Compare task counts (PLAN vs LEARNINGS) | Run diagnostic code, profile data, inspect intermediate files |
| **Scope** | Re-read task specification from PLAN.md | Grep/Glob project files for patterns |

### The Rule

```
Subagent returns
    ↓
Read subagent's report (ALLOWED)
    ↓
Need more information?
    ↓
YES → Spawn a NEW Task agent to investigate (REQUIRED)
NO  → Log to LEARNINGS.md and proceed to next task (ALLOWED)
    ↓
NEVER: Read source files, run analysis code, or explore data yourself
```

### Iron Law

**If you need to investigate, DELEGATE. If you need to verify, use STATE FILES.**

The distinction is simple:
- **Verification** = checking that work was done (state files, file existence, task counts)
- **Investigation** = understanding HOW work was done (reading code, running queries, exploring data)

Main chat does verification. Subagents do investigation.

**Exception: Answering subagent questions.** When a subagent asks for clarification ("Should I drop or impute nulls?"), you MUST answer directly. This is orchestration, not investigation. Answer the question, then re-dispatch. Do NOT read source code to formulate your answer — use SPEC.md and PLAN.md context.
</EXTREMELY-IMPORTANT>

### Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "Let me quickly check the data" | You're about to investigate, not verify. "Quickly" is how every protocol violation starts. | Read LEARNINGS.md for the subagent's data summary |
| "Let me verify the output looks right" | If you're reading output files, you're investigating. Verification = checking LEARNINGS.md says "COMPLETE" with verified output. | Check LEARNINGS.md entry, not the data itself |
| "Quick look at the notebook" | You're about to read implementation code. That's investigation. | If notebook quality matters, dispatch a code review subagent |
| "I need to understand what the analyst did" | The analyst's report tells you what they did. Reading their code is investigation, not understanding. | Read the subagent's returned report |
| "Just confirming the merge worked" | Confirming = running code = investigation. The analyst already confirmed in their output-first protocol. | Trust the verified output in the subagent report |
| "The results seem off, let me check" | If results seem off, that's a new investigation task. Don't do it yourself. | Dispatch a fresh Task agent to investigate the discrepancy |

### Red Flags — STOP If You Catch Yourself Thinking:

- **"Let me check the data"** → STOP. That's investigation. Delegate it.
- **"Let me verify the output"** → STOP. Read LEARNINGS.md instead.
- **"Quick look at the notebook"** → STOP. Dispatch a review subagent.
- **"I'll just read the CSV to confirm"** → STOP. Check file existence with `ls`, not contents.
- **"Let me run a quick query"** → STOP. Running queries is analysis, not orchestration.
- **"I need to see what happened"** → STOP. The subagent report tells you what happened.

### Drive-Aligned Framing

| Drive | Why You Investigate | What Actually Happens |
|-------|--------------------|-----------------------|
| **Helpfulness** | "I should verify before proceeding" | You re-do the subagent's work, wasting time. Your "verification" is investigation that should have been delegated. Anti-helpful. |
| **Competence** | "I need to understand the analysis" | You read code to feel informed. But you're the orchestrator, not the analyst. Understanding implementation details is the subagent's job. |
| **Efficiency** | "Faster to check myself than spawn another agent" | You spend 10 minutes reading code. A subagent takes 2 minutes and produces a structured report. Your "efficiency" was slower. |

---

## C6: Topic Change Protocol

When user sends an off-topic message during an active DS workflow phase, main chat MUST NOT silently switch context. Silent context switches kill iterative loops — the workflow state is lost, and the user must re-invoke the skill.

### The Protocol

```
User sends off-topic message during active phase
    ↓
1. ANNOUNCE: "Pausing [phase name] to address your request."
    ↓
2. HANDLE: Process the off-topic request (normal tools allowed outside the workflow loop)
    ↓
3. ANNOUNCE: "Resuming [phase name]. Reading state files for current progress."
    ↓
4. RELOAD: Read LEARNINGS.md / PLAN.md / SPEC.md to restore context
    ↓
5. RESUME: Continue from where you left off (spawn next subagent or proceed to next task)
```

### What Counts as Off-Topic

| Off-Topic (Pause Required) | On-Topic (No Pause Needed) |
|----------------------------|---------------------------|
| "What's in the raw data?" (exploration during implement) | "Should task 3 use median or mean?" (methodology question for current task) |
| "Generate a summary of results so far" (reporting during implement) | "The analyst asked about null handling" (answering subagent question) |
| "Can you check my other project?" (different project entirely) | "Skip task 4, it's not needed" (scope change for current workflow) |
| "Describe this image for me" (unrelated task) | "Add a new task after task 5" (plan modification for current workflow) |

### Red Flags — STOP If You Catch Yourself:

- **Answering a data exploration question without announcing pause** → STOP. Announce pause first.
- **Reading project files to answer user's question mid-implementation** → STOP. That's both off-topic AND investigation.
- **"I can answer this without pausing"** → STOP. If it's not about the current task, it requires a pause announcement.

### Drive-Aligned Framing

| Drive | Why You Skip the Pause | What Actually Happens |
|-------|------------------------|----------------------|
| **Helpfulness** | "User asked a question, I should answer immediately" | You answer inline, context is corrupted, implementation loop dies. User must re-invoke `/ds` and lose progress. Your "helpfulness" cost them 30 minutes. |
| **Efficiency** | "Pausing takes too long, I'll just answer quickly" | The pause announcement takes 5 seconds. Without it, you lose the loop and spend 10 minutes reloading state. Anti-efficient. |
| **Competence** | "I can handle both the question and the task simultaneously" | You can't. Context windows are finite. Answering the question pushes task state out of context. Your multitasking is a delusion. |

---

## C7: DS-Specific Escape Patterns

These patterns were identified from observed failures in delegated workflows. Each pattern describes HOW main chat escapes its orchestrator role and starts doing investigation/implementation work directly.

### Pattern A: "Verification" Rationalization

```
Trigger: Subagent returns output
Thought: "I should verify the output is right"
Action: Reads source code, runs analysis queries, inspects data files
Violation: Investigation disguised as verification
```

**STOP trigger phrases:**
- "Let me check the data"
- "Let me verify the output"
- "Quick look at the notebook"
- "I'll just confirm the results"
- "Let me see what the analyst did"

**Fix:** Read LEARNINGS.md, not source files. If something looks wrong, spawn a new Task agent.

### Pattern B: Silent Topic Change

```
Trigger: User asks "What's in the cleaned data?" during ds-implement
Thought: "This is related, I can answer it"
Action: Reads CSVs, queries database, runs exploratory analysis
Violation: Implementation loop paused without announcement; context corrupted
```

**STOP trigger phrases:**
- "Let me look at that for you" (during active phase)
- "I can check that quickly" (during active phase)
- "Here's what's in the data" (without pause announcement)

**Fix:** Announce pause, handle request, announce resume, reload state.

### Pattern C: Urgency Bypass

```
Trigger: Subagent reports unexpected error or data quality issue
Thought: "I need to act NOW before proceeding"
Action: Runs 20 diagnostic queries, reads data profiles, modifies PLAN.md
Violation: Orchestrator doing investigation + implementation + planning simultaneously
```

**STOP trigger phrases:**
- "This needs immediate attention"
- "Let me diagnose this quickly"
- "I'll fix this before moving on"

**Fix:** Log the issue in LEARNINGS.md. Dispatch a fresh Task agent to investigate. Do not investigate yourself. Even genuinely urgent issues (data corruption, system failures) are delegated — dispatch with "URGENT:" prefix, but do NOT investigate in main chat.

### Pattern D: Pre-Delegation Investigation

```
Trigger: Task is about to start, or previous task failed
Thought: "I'll diagnose first, then tell the Task agent what to fix"
Action: Reads code, runs diagnostic commands, forms hypothesis
Violation: Main chat already did the investigation; Task agent duplicates or is biased
```

**STOP trigger phrases:**
- "Let me understand the issue first"
- "I'll look at the code before dispatching"
- "Let me check what went wrong"

**Fix:** Dispatch the Task agent with the error report. Let the subagent investigate with fresh eyes. Your pre-investigation biases the subagent.

### Summary: STOP Trigger Quick Reference

| Phrase | Pattern | What To Do Instead |
|--------|---------|-------------------|
| "Let me check the data" | A: Verification rationalization | Read LEARNINGS.md |
| "Let me verify the output" | A: Verification rationalization | Read subagent report |
| "Quick look at the notebook" | A: Verification rationalization | Dispatch review subagent |
| "I can check that quickly" | B: Silent topic change | Announce pause first |
| "This needs immediate attention" | C: Urgency bypass | Log issue, dispatch subagent |
| "Let me understand the issue first" | D: Pre-delegation investigation | Dispatch subagent with error report |
| "I'll just confirm the results" | A: Verification rationalization | Trust output-first protocol |
| "Let me look at that for you" | B: Silent topic change | Announce pause first |
| "I'll fix this before moving on" | C: Urgency bypass | Delegate the fix |
| "Let me check what went wrong" | D: Pre-delegation investigation | Dispatch investigator subagent |

---

## C8: Deviation Rules

Implementation subagents follow a 4-rule system for unplanned discoveries:

- **R1-R3 (Auto):** Bugs, missing critical checks, and blockers are fixed automatically with output-first verification and tracked in `.planning/LEARNINGS.md`.
- **R4a/R4b (STOP):** Data assumption violations and methodology changes require user decision before proceeding.

**Priority:** R4 (STOP) > R1-R3 (auto) > unsure → R4.

Each task's LEARNINGS.md entry must include a deviation summary line. This is not optional — it's how we know what changed from the plan.

### Rationalization Prevention (Deviation Rules)

| Thought | Reality |
|---------|---------|
| "This data issue is minor, just fix it" | If it changes what the data represents, it's R4a. User decides. |
| "I'll note the methodology change later" | Later = never. STOP now, track it. |
| "The user won't care about this deviation" | Undisclosed deviations are undisclosed assumptions. User MUST know. |
| "Tracking deviations slows me down" | 30 seconds of tracking prevents hours of "why did the results change?" |

---

## How to Use

Each ds-family skill should Read() this file at the start of its process. Phase-specific enforcement (Iron Laws, phase-specific rationalizations) remains in each skill's SKILL.md. This file provides the shared baseline that prevents cross-skill drift.

```bash
# From any skill — discover via plugin cache:
${CLAUDE_PLUGIN_ROOT}/references/ds-common-constraints.md
# Then Read() the output path
```
