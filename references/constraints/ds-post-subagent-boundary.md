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
