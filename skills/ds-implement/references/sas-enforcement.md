# SAS Language Routing

**After reading PLAN.md, check the `Implementation Language` field. If it says SAS or Mixed, you MUST load the SAS performance enforcement BEFORE dispatching any SAS tasks.**

If PLAN.md contains "Implementation Language: SAS" or "Mixed", discover and read SAS ETL enforcement:
Read `${CLAUDE_SKILL_DIR}/../../skills/wrds/references/sas-etl.md` and follow its instructions.

**SAS subagent prompts MUST include the following enforcement block** (paste into every SAS Task agent prompt):

```
## SAS Performance Enforcement (Non-Negotiable)

Before writing ANY SAS code, validate against these rules:

### Probe Inputs First (metadata only — seconds)
- `proc contents data=lib.x varnum;` on EVERY input — variables, types, lengths, formats, and the index section
- Compare key lengths across datasets you will merge — a `$6` vs `$8` gvkey matches zero rows silently
- `proc sql; select memname, nobs from dictionary.tables where libname='LIB';` — know the row scale before committing
- `proc print data=lib.x(obs=20); var ...;` — always `obs=`, always `var`. NEVER print an unbounded WRDS table
- `proc datasets library=scratch;` to inventory/delete intermediates (metadata op; end with `quit;`)

### WHERE Clauses
- **NEVER** wrap indexed columns in functions: year(date), month(date), datepart(dt), upcase(), substr()
- **ALWAYS** use range-based date filters: `where date between "01jan&year."d and "31dec&year."d`
- If you write `where year(anything)`, DELETE it and rewrite as BETWEEN.

### Merge Strategy
- Small lookup + large table → hash object (declare hash h; h.defineKey; h.defineData; h.defineDone)
- NEVER use PROC SORT + DATA merge for lookup joins when hash is possible
- Sort-merge ONLY when both tables exceed 50M rows (document justification)

### Parallelism
- Multi-year jobs → SGE array (#$ -t start-end), NOT %do loops
- Pass year via -sysparm, NOT -set or %sysget
- Per-year log files, NOT shared log

### Macro Safety
- Double quotes in h.output() for macro resolution (NEVER single quotes)
- Terminate macro vars with period: &year. not &year
- Assign hash methods to temp vars before put statements

### Self-Check Before Submitting Code
- [ ] Inputs probed with PROC CONTENTS (lengths + indexes) and PROC PRINT (obs=20) before any ETL was written
- [ ] No function-wrapped WHERE clauses on indexed columns
- [ ] Hash used for all lookup merges
- [ ] SGE array for multi-year processing
- [ ] Double quotes where macro resolution needed
- [ ] Single-year benchmark before full array — on the **most RECENT / densest** period, never a convenient old one. Data density grows over time, and these engines are volume-dominated, so an old-period benchmark under-sizes the full run by the growth factor (measured: a 2021 TAQ day = 7M trades / ~31 min vs a 2025 day = 113M trades / ~85 min — 16× more trades on a similar quote scan; benchmarking the 2021 day would have projected the array ~2.7× too fast).
```

**Skipping WHERE clause pattern checks is NOT HELPFUL — unverified SAS code fails silently and wastes the user's compute time.**
