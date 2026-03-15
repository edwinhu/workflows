# SAS Language Routing

**After reading PLAN.md, check the `Implementation Language` field. If it says SAS or Mixed, you MUST load the SAS performance enforcement BEFORE dispatching any SAS tasks.**

If PLAN.md contains "Implementation Language: SAS" or "Mixed", discover and read SAS ETL enforcement:
```bash
ls -d ~/.claude/plugins/cache/edwinhu-plugins/workflows/*/skills/wrds/references/sas-etl.md 2>/dev/null | sort -V | tail -1
```
Use the output path with `Read()`.

**SAS subagent prompts MUST include the following enforcement block** (paste into every SAS Task agent prompt):

```
## SAS Performance Enforcement (Non-Negotiable)

Before writing ANY SAS code, validate against these rules:

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
- [ ] No function-wrapped WHERE clauses on indexed columns
- [ ] Hash used for all lookup merges
- [ ] SGE array for multi-year processing
- [ ] Double quotes where macro resolution needed
- [ ] Single-year benchmark before full array
```

**Skipping WHERE clause pattern checks is NOT HELPFUL — unverified SAS code fails silently and wastes the user's compute time.**
