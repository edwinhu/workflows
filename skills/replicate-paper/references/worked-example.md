# Worked example: two grinds from one day (hidden-figures, 2026-10-06)

Both loops ran under the same user decision: "for certain key papers we need to grind harder on each to try and actually replicate, we are giving up too early, need to allow deviations like with agk", extended by "Grind Antoniou / ADKO". Both were launched through `grind` with the gate on the filed `"key":"leads_exhausted"`.

## Antoniou, Li, Liu, Subrahmanyam and Sun (2022, RFS): fragile hit, accepted

**Target.** Table 2 Panel A, coefficient on Q_{t-1} x ETF_{t-1}, three cells significant in print, gated jointly. The paper prints coefficient and t, so se = coef / t:

| cell | published coef | t | derived se | 95% CI | committed run (2009-2016, N 12,839) |
|---|---|---|---|---|---|
| CAPXRND | 0.145 | 5.09 | 0.028487 | [0.0892, 0.2008] | 0.1069, t 4.19, IN |
| CAPX | 0.037 | 2.73 | 0.013553 | [0.0104, 0.0636] | 0.0166, t 1.46, OUT (t) |
| RND | 0.109 | 5.00 | 0.021800 | [0.0663, 0.1517] | 0.0917, t 4.29, IN |

Published nulls (CF x ETF) were never gated. Gated windows: 2009-2016 (the committed bar window) and 2003-2016 (the paper's own). `frozen.md5` covered 13 files: the committed CSV, the pull and estimation scripts, the SAS pipeline, the test, the note and the run report.

**Phase 1** (`antoniou22.jsonl`, 12 leads each citing paper lines and code lines). `g_01`-`g_12` priced on data on disk. Best: `g_04`, the 100% growth screen read on year-t growth instead of t-1 (paper p. 15). It moved the SG mean from 0.070 to 0.127 against the paper's 0.124, a non-outcome moment that supports the reading. CAPXRND IN, RND IN, CAPX 0.0207, t 1.93. Two of three cells IN, so not a hit.

**Phase 2** (`PROMPT2.md` = a `# PHASE 2` header + `PROMPT1.md`, new journal `antoniou22_p2.jsonl`). The header named three leads in order: (A) one SGE pull per source to reach the paper's own window 2003-2016, with Fama-French book-equity items in the same Compustat pull; (B) price `g_04` in 2003-2016; (C) singletons. It also told the loop not to stack more phase-1 switches searching for t on CAPX. `g_13` = `g_04` in 2003-2016: CAPXRND 0.1274 (t 4.82), CAPX 0.0243 (t 2.18), RND 0.1029 (t 4.84), n 23,903 against the paper's 21,922. HIT.

**Closing.**
1. Verified against the printed table, then put to the user, who accepted it as fragile.
2. The user asked for two robustness rows on the hit build. `g_14` (FF book-equity Q): CAPX t 2.27 in 2003-2016, still t 1.93 in 2009-2016. `g_15` (singletons dropped): nothing changes. `check.sh` printed HIT for `g_14`, but it is disclosed as robustness and not counted as a second hit.
3. Disclosure: 13 `g_` search steps plus 3 pulls, with the robustness rows shown separately. Fragility: CAPX clears 1.96 only in the paper's own window, by 0.2 in t, and the hit rests on an outcome-conditioned carry-forward of `g_04`.
4. Scoreboard: three appended rows tagged `in-design search hit:` that name each other, `lock_status` `searched`, `n_specs_searched` 13. The main tally stayed at 50 pass / 34 fail.

## Azar, Duro, Kadach and Ormazabal (2021, JFE): not reproduced

**Target.** Table 4, Log(CO2) on Big3_Hldg_{t-1}, columns 1-3: -3.44 (t -5.76), -1.69 (t -2.27), -1.00 (t -2.83), per unit fraction. Only the ECGI working paper was on disk, which `check.sh`'s header states ("JFE values may differ"). The ledger is per percentage point, so the header documents the scale (per-pp = fraction / 100) and how it was inferred from the paper's own reading of the coefficient.

**Gate change, recorded verbatim.** `check0.sh` first gated column 3 alone. The user then decided "Gate cols. 1-3 jointly" (2026-10-06), so `check.sh` gates all three on one step, with that quote in its header. The country FE that the US-only sample absorbs is documented per column.

**Search.**
- 15 `g_` steps, including the paper-stated rstudent 2.5 outlier screen (adko.txt fn 11), the BlackRock/BGI parent roll-up via an SGE pull, fund-level NonBig3, scope 1+2 outcome, the top-1,000 cut dated at year t, reghdfe singleton dropping, and FactSet `own_v5` fund holdings (the paper's own source).
- Every Big3 measure had to declare `measure=fund` or `measure=factset_fund` in `switches`, and `check.sh` enforces that token.
- Best per cell: t4c1 IN (`g_10`, t -3.46); t4c2 never past |t| 0.83; t4c3 best t -0.77, and FactSet fund holdings gave it the wrong sign.
- The annual `ppent` lead needed a pull and was floored with its reason; then `leads_exhausted` was filed.

**Closing.** Phase 1 (`adko21.jsonl`) stalled at iteration 10. Phase 2 ran on a new journal (`adko21_p2.jsonl`, `PROMPT2.md`). Once it filed `leads_exhausted`, the gate turned every further pass into a free `wait`, and the operator ended the loop with `grind.sh stop`. The result is recorded as NOT reproduced under the user's joint rule, with 15 steps disclosed and the outcome-source caveat (LSEG, because Trucost was refused on WRDS).

## What generalises

- The binding cell is usually one of the gated cells; name it in PROMPT.md with the coef and t it needs.
- A non-outcome moment (a summary mean that moves toward the paper's Table 1) is the evidence that makes a reading defensible. A t-statistic rising is not.
- Every closed loop leaves a ledger, a dated note with every step's declaration and check output, and a count. A non-replication is reported with the same disclosure as a hit.
