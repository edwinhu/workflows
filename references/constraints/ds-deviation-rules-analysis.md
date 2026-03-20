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

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "This data issue is minor, just fix it" | If it changes what the data represents, it's R4a. User decides. | Check: does this change meaning? If yes → R4 |
| "I'll note the methodology change later" | Later = never. STOP now, track it. | STOP and present to user immediately |
| "The user won't care about this deviation" | Undisclosed deviations are undisclosed assumptions. User MUST know. | Track it and present |
| "Adding this control is standard" | Standard doesn't exempt it from R4 if you added it after seeing results | Was it in PLAN.md? If not → R4 |

## Red Flags

- **"Results improved after I..."** → STOP. You changed the spec after seeing results. That's R4.
- **"I added a standard control"** → STOP. Was it in PLAN.md before you saw results? If not → R4.
- **"The original spec was wrong"** → STOP. Maybe, but that's still R4. User decides.
