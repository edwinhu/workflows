---
name: post-subagent-boundary
description: After subagent returns, main chat MUST NOT read source/data — verify via state files only
applies-to: [ds, ds-fix, ds-implement, ds-review, ds-verify, ds-delegate]
---

<EXTREMELY-IMPORTANT>

## Rule

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

**If you need to investigate, DELEGATE. If you need to verify, use STATE FILES.**

- **Verification** = checking that work was done (state files, file existence, task counts)
- **Investigation** = understanding HOW work was done (reading code, running queries, exploring data)

Main chat does verification. Subagents do investigation.

**Exception: Answering subagent questions.** When a subagent asks for clarification ("Should I drop or impute nulls?"), you MUST answer directly. This is orchestration, not investigation. Answer the question, then re-dispatch. Do NOT read source code to formulate your answer — use SPEC.md and PLAN.md context.

</EXTREMELY-IMPORTANT>

## Rationale

**Why this exists** — The post-subagent moment is the highest-risk point in any delegated workflow. Main chat "verifies" by investigating — reading code, running queries, exploring data. This is investigation disguised as verification. It bypasses the delegation model and produces biased, unstructured results.

## Examples

### Correct
```
# After subagent returns:
Read(".planning/LEARNINGS.md")  # Check subagent logged completion
ls -la output/                   # Verify output file exists
# Proceed to next task
```

### Incorrect
```
# After subagent returns:
Read("src/analysis.py")          # INVESTIGATION — reading source code
head -20 output/results.csv      # INVESTIGATION — reading data contents
python3 -c "import pandas..."    # INVESTIGATION — running analysis code
```

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "Let me quickly check the data" | You're about to investigate, not verify. "Quickly" is how every protocol violation starts. | Read LEARNINGS.md for the subagent's data summary |
| "Let me verify the output looks right" | If you're reading output files, you're investigating. Verification = checking LEARNINGS.md says "COMPLETE" with verified output. | Check LEARNINGS.md entry, not the data itself |
| "Quick look at the notebook" | You're about to read implementation code. That's investigation. | If notebook quality matters, dispatch a code review subagent |
| "I need to understand what the analyst did" | The analyst's report tells you what they did. Reading their code is investigation, not understanding. | Read the subagent's returned report |
| "Just confirming the merge worked" | Confirming = running code = investigation. The analyst already confirmed in their output-first protocol. | Trust the verified output in the subagent report |
| "The results seem off, let me check" | If results seem off, that's a new investigation task. Don't do it yourself. | Dispatch a fresh Task agent to investigate the discrepancy |

## Red Flags

- **"Let me check the data"** → STOP. That's investigation. Delegate it.
- **"Let me verify the output"** → STOP. Read LEARNINGS.md instead.
- **"Quick look at the notebook"** → STOP. Dispatch a review subagent.
- **"I'll just read the CSV to confirm"** → STOP. Check file existence with `ls`, not contents.
- **"Let me run a quick query"** → STOP. Running queries is analysis, not orchestration.
- **"I need to see what happened"** → STOP. The subagent report tells you what happened.

## Drive-Aligned Framing

| Drive | Why You Investigate | What Actually Happens |
|-------|--------------------|-----------------------|
| **Helpfulness** | "I should verify before proceeding" | You re-do the subagent's work, wasting time. Your "verification" is investigation that should have been delegated. Anti-helpful. |
| **Competence** | "I need to understand the analysis" | You read code to feel informed. But you're the orchestrator, not the analyst. Understanding implementation details is the subagent's job. |
| **Efficiency** | "Faster to check myself than spawn another agent" | You spend 10 minutes reading code. A subagent takes 2 minutes and produces a structured report. Your "efficiency" was slower. |
