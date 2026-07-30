---
name: post-subagent-boundary
description: After an agent returns, the DS orchestrator verifies from returned reports, the approved PLAN, and project auto-memory — never by investigating source or data
applies-to: [ds, ds-fix, ds-implement, ds-review, ds-delegate]
---

<EXTREMELY-IMPORTANT>

## Rule

**After ANY task agent returns, the DS orchestrator MUST NOT read source files, notebooks, or data. This is not negotiable.**

The orchestrator coordinates work. It reads the agent's returned report, the immutable approved PLAN, project auto-memory, and the live `TaskList`; agents investigate and implement. Technical `VERIFY` belongs to `ds-implement`, not to the orchestrator or `ds-review`.

### Verification vs Investigation

| Category | Orchestrator CAN Do | Orchestrator CANNOT Do |
|----------|---------------------|------------------------|
| **Workflow records** | Read the immutable approved PLAN, project auto-memory, live `TaskList`, and the agent's returned report | Rewrite the approved PLAN or reconstruct implementation detail from source |
| **Technical verification** | Dispatch `ds-implement` to run it and read its returned evidence | Read project source, analysis scripts, notebooks, or data; re-run analysis code |
| **Data** | Ask an agent whether an output exists and read its report | Read CSV/parquet contents, run `head`, query databases |
| **Diagnostics** | Compare Plan task identities to `TaskList` and returned reports | Run diagnostic code, profile data, inspect intermediate files |
| **Scope** | Re-read a task in the approved PLAN | Grep/Glob project files to infer what happened |

### The Rule

```
Task agent returns
    ↓
Read its returned report (ALLOWED)
    ↓
Need technical evidence or investigation?
    ↓
YES → Dispatch ds-implement to investigate or VERIFY (REQUIRED)
NO  → Curate reusable returned facts into project auto-memory; proceed through TaskList (ALLOWED)
    ↓
NEVER: Read source files, run analysis code, explore data, or alter the approved PLAN yourself
```

**If you need to investigate or technically verify, delegate to `ds-implement`. If you need to coordinate, use returned reports, the approved PLAN, project auto-memory, and `TaskList`.**

- **Coordination** = tracking approved work, task status, returned evidence, and reusable facts.
- **Technical verification** = checking how work behaves or whether technical acceptance criteria pass; `ds-implement` owns it.
- **Investigation** = understanding how work was done by reading code, querying data, or inspecting artifacts; an implementation agent owns it.

**Exception: Answering agent questions.** When an agent asks for clarification ("Should I drop or impute nulls?"), answer directly from the approved PLAN and returned context, then re-dispatch. Do not inspect source or data to formulate the answer.

</EXTREMELY-IMPORTANT>

## Rationale

**Why this exists** — The post-agent moment is the highest-risk point in a delegated workflow. An orchestrator that "quickly verifies" by investigating has collapsed the role boundary, duplicated work, and biased the next agent. A human-feedback review that performs technical verification similarly stops being a review. The user benefits from independent technical evidence and a stable approved PLAN, not a coordinator improvising a second implementation.

## Examples

### Correct
```
# After a task agent returns:
Read(returned_report)                    # Check reported evidence
TaskList()                                # Check remaining approved work
# Need a technical check? Dispatch ds-implement with the acceptance criterion.
# Curate any reusable returned fact into project auto-memory.
```

### Incorrect
```
# After a task agent returns:
Read("src/analysis.py")                  # INVESTIGATION — reading source code
head -20 output/results.csv               # INVESTIGATION — reading data contents
python3 -c "import pandas..."             # TECHNICAL VERIFICATION — belongs to ds-implement
Edit(".planning/PLAN.md", ...)           # The approved PLAN is immutable
```
