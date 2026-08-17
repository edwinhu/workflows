# Competing-Hypothesis Diagnosis

Use this reference only to classify an ambiguous diagnosis before selecting a DS-fix route. It does not
create an investigation team and does not implement a fix.

## When to use it

Use a structured comparison when the symptom has several plausible, materially different causes:

| Condition | Example |
|---|---|
| Three or more plausible causes | Wrong coefficient sign could arise from a source change, join duplication, method, or real confounding |
| Contradictory diagnostics | Row-count checks pass but coverage and result checks disagree |
| An uncertain cause changes routing | One cause would be an ordinary tactical repair, another would require R4 replanning |

For each candidate cause, state:

1. the read-only evidence that would support it;
2. the read-only evidence that would refute it;
3. the smallest inspection needed to distinguish it; and
4. whether confirming it changes the approved plan contract.

Use direct, bounded read-only inspection only. Do not delegate a team or make changes while diagnosing.
If the evidence establishes an R4 condition, immediately route to `/ds` native replanning. If it leaves
the approved plan intact, the finding becomes a row in the craft plan's task table and is verified by
craft's own independent verifier.

## Evidence table

| Candidate cause | Supporting evidence | Refuting evidence | Routing consequence |
|---|---|---|---|
| Data-quality/source issue | Profile changes in schema, grain, coverage, nulls, duplicates, or keys | Current profile matches approved source assumptions | R4 when source/grain/scope/evidence changes; otherwise tactical |
| Methodology issue | Assumption or design check conflicts with planned method | Checks support the planned method | R4 |
| Implementation issue | First divergence is a localized task implementation defect | Earlier source/profile evidence already diverges | Tactical only if current criteria and outputs remain valid |
| Real/domain effect | Source and pipeline checks support the unexpected result | Evidence identifies a source/method/implementation defect | R4 if interpretation, scope, or review evidence changes |

**Fact:** a plausible cause is not a verified cause. Claiming a route without the distinguishing evidence
is anti-helpful because it sends implementation against the wrong contract.
