You are one iteration of grind loop `<ID>` in <ROOT>. Price ONE `g_` step per iteration (any combination of in-fence switches, each named before pricing), then exit. Budget: <N> minutes of work.

## What this loop is

User decision <YYYY-MM-DD>: "<verbatim quote authorising the in-design search>". This is the AGK in-design rule applied to <Authors (Year, Journal)>, <Table>. It is an OUTCOME-CONDITIONED, DISCLOSED specification search: every row is a labelled search row, and the paper reports the count of rows tried beside any hit.

Committed baseline (never changed by this loop): <output file> (md5 <...>), <measure>, window <...>, N <...>: <cell coef (se, t) per gated cell>. Note: <docs/investigations/...>. Paper text: <paper.txt> (<section: lines>, <variable definitions: lines>, <table: lines>).

## Target

Run `bash <LOOP>/check.sh; echo rc=$?` first and last. It exits 0 when ONE `g_` step, in a gated window (<windows>), has EVERY gated cell IN (joint rule): published sign, |t| >= 1.96 on our own coef/se, coef inside the published 95% CI<, first-stage F >= N>.

| cell | published coef | t or p | derived se | 95% CI | ours (committed) |
|---|---|---|---|---|---|
| <cell> | <b> | <t> | <se> | [<lo>, <hi>] | <b, t, IN/OUT (why)> |

Binding cell: <which cell, and what coef/t it needs>. Published nulls never count. A row whose `switches` contain `inference_only=1` prints but never ranks or hits; set it only for a purely inference switch (clustering, SE type, dof). Steps the user rejected are listed in check.sh and never hit.

## Ledger

Append-only: data/output/<ID>_grind.csv, header `step,cell,window,class_rule,coef,se,t,p,n,first_stage_F,switches,sample_n`. One row per gated cell per step x window; `switches` = every switch versus the committed run, `;`-joined `key=value`; `sample_n` = units in the window sample. Never delete, overwrite or re-price a row; a corrected build gets a new step number and says what it corrects. Next number: `cut -d, -f1 data/output/<ID>_grind.csv | grep -o '^g_[0-9]*' | sort -u | tail -1`, plus one. Step name `g_NN_<slug>`.

## The design fence

Allowed: choices the paper leaves open, or defensible readings of its text, each cited by page or line.
- Sample filters: <list, with page/line>.
- Windows inside the paper's own period: <...>.
- Variable construction: <each variable and the readings the text admits, with page/line>.
- Data source or vintage already on disk, or one new pull per source (WRDS rules below).
- Winsorizing scope and order at the paper's stated percentiles.

Forbidden:
- Controls, interactions, fixed effects or estimators the paper lacks.
- Dropping or selecting observations on the outcome, the residual or influence diagnostics.
- Inference-only changes as hits.
- Tuning a cutoff (split, percentile, bandwidth, size cut) away from the paper's value; an alternative only as a textual reading named in the note BEFORE its row is priced. N and treated shares are reported, never targeted.
- Editing raw values; fabricating published numbers; windows outside the paper's.
- Changing anything in <LOOP>/frozen.md5 or check.sh.

## Ranked leads (most promising first; each cites the paper's page/line and the code line it changes)

1. **<lead>.** <gap between our build and the paper, with the moment that shows it>; paper: "<quote>" (<page/line>); code: <file:line>. Readings: <...>.
2. ...

Read GRIND_FLOORS, GRIND_SUBJECTS and GRIND_NOTES first; operator notes outrank this ranking. Stack only switches each named in a note before pricing; never choose one because it raised the t.

## How to compute

- Reuse the committed script as a library or copy functions into a NEW script numbered after the highest existing one, with its own test; never edit the frozen files. The estimator stays the paper's.
- Declare before estimating: append `[deviation_declared] loop=<ID> step=g_NN_<slug> parent=<committed run> switches=<...> fence=<why each is inside the fence> rationale=<paper text with page or line>` to logs/<ID>_grind.log.
- Print the row-count chain and every join's rows in, rows out and match rate; print the summary-statistic means of any construction you change next to the paper's.
- Never write a ledger row from a run that did not finish.

## WRDS rules

SAS on SGE via qsub only, never Postgres. No login-node compute. One-year test job, inspect it, then ONE full pull per source over the whole window. While a job runs, record an `attempt` naming the job id and exit; the next iteration fetches and prices.

## Note

Append a section per iteration to docs/investigations/<YYYY-MM-DD>_<ID>-grind.md (header: outcome-conditioned search, running count of rows): the declaration verbatim, the row-count chain, the gated cells beside the published and committed ones, and the check output verbatim.

## Record: one journal record per iteration

Append with `bash "$GRIND_SH" append --journal "$GRIND_JOURNAL" '<one-line json>'`, `subject` = the switch family.
- `progress`, keyed by the step: ONLY when a BEST line rises by at least 0.05 in t, MOST_CELLS_IN rises, or a HIT appears.
- Otherwise `attempt`, with the step, the coefs and t's, and sample_n.
- `floor`, keyed by a family that cannot be built, with the reason.
- When every lead is floored or priced, append once `{"kind":"floor","key":"leads_exhausted","why":"..."}` and price nothing further. Do not write that string anywhere else.

## Hard rules

- check.sh exits 2 on a frozen-file change, a header change or a repeated step x cell x window.
- Run the new script's tests every iteration.
- Git: commit ONLY your own new files, the ledger and the note section, with explicit paths; never `git add -A`, never push.
- Then exit. Only check.sh's exit code ends the loop.
