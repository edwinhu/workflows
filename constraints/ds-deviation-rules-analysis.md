---
name: deviation-rules-analysis
description: Analysis-specific deviation rules — R4 gate for methodology changes after seeing results
applies-to: [ds-delegate]
---

## Rule

Analysis tasks have domain-specific deviation rules extending the base R1-R4 system:

| Rule | Trigger | Action |
|------|---------|--------|
| R1: Bug | Code error, wrong formula, transposed variables | Auto-fix → re-run → verify → track |
| R2: Missing | No robustness checks, no SE justification, no sample documentation | Add → verify → track |
| R3: Blocking | Package not installed, data not accessible, memory error | Fix → verify → track |
| R4: Methodology | Switching estimator, changing sample period, adding/removing controls AFTER seeing results, changing dependent variable | STOP → present to user |

**R4 is the critical gate for analysis.** Any specification change after seeing results is methodology drift. The user must approve it explicitly.

## Rationale

**Why this exists** — "I changed the controls because results were insignificant" is p-hacking, not analysis. The R4 gate ensures that any post-results methodology change gets explicit user approval, preventing silent specification search.

## Examples

### Correct (R4 triggered)
```
Agent: "After running the main regression, results are insignificant (p=0.23).
I notice that adding industry fixed effects might be appropriate.
This is an R4 deviation (methodology change after seeing results).
Should I: (a) add industry FEs, (b) keep current spec, (c) other?"
```

### Incorrect (R4 bypassed)
```
Agent: "Results were insignificant, so I added industry fixed effects
and the coefficient is now significant at 5%. Here are the updated results."
# Specification change after seeing results without user approval
```
