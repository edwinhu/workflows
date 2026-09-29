# GRIND_PLAN — parse_def14a_own

Setup only. **The grind has not been started.** Sections 1-6 were measured on
2026-09-28; every number is a line a command printed, with the command quoted.
**Section 7 is a dated amendment (2026-09-29) and supersedes §1 on the holdout
and §3 on the precision threshold.** Read it before §1.

## 1. What is being improved, and against what

The parser is `parse_def14a_own_go`. The ruler is `scorer/score.py` scored
against two gold sets built from licensed WRDS data, linked to the DEF 14A that
produced them:

| gold set | grain | span | rows | filings | firms |
|---|---|---|---|---|---|
| `blockw` — WRDS Blockholders (Dlugosz, Fahlenbrach, Gompers & Metrick) | holder × company × IRRC year | 1996-2001 | 20,336 | 7,321 | 1,930 |
| `factset` — `factset_own.own_stakes_detail_eq`, percent computed against `own_sec_prices_eq.adj_shares_outstanding` | holder × security × report date, reduced to firm-year | 2006-2021 | 35,277 holder rows → 2,647 firm-years | 2,647 | 2,130 |

Union: **9,968 DEF 14A filings across 3,733 firms.** A random **20% of FIRMS
(747) is the holdout**, seed `20260928`, recorded in
`/data/def14a_own/gold/holdout.json`; the grind scores the 2,986 dev firms
(8,027 filings) and never the other 1,941 filings. The split is at the firm
level because a firm's consecutive proxies share layout and holder names.

**One correction to the brief, made because the data said so.** The brief
proposed selecting FactSet's proxy-sourced stakes by a `source_code`/`comments`
marker ("e.g. PXY"). Measured:

```
comments ILIKE '%PXY%', US securities, 2006-2021 : 3,546 rows / ~400 securities
  of which source_code 'R'                        : 2,048 (24.7% of all R rows)
  of which source_code 'O'                        :   798 (0.087% of all O rows)
```

and most of those comments read `VIA <other issuer> PXY` — a stake in a
*different* company disclosed through that company's proxy. No decode table for
the field exists (`factset.ref_metadata_codes` has no `own_stakes` entry), and
the period-end test that would isolate the 13F feed fails (source_code `K` is
only 7.5% month-end, so `report_date` is an event date). The gold set is
therefore defined by the **proxy window** — stakes with `report_date` in
[filing_date − 90d, filing_date + 7d], latest per holder — which selects *when*,
never *what*. `n_pxy_rows` is carried per firm-year: only **21 of 2,647** linked
firm-years carry a PXY-marked row, which is why the marker cannot be the
definition.

### Join rates (every leg printed by the builder)

blockw → DEF 14A, denominator 20,975 blockw rows:

```
dropped, permno has no CRSP name row : 66 (0.31%)
dropped, cusip not in wciklink_cusip : 109 (0.52%)
dropped, no DEF 14A in the window    : 464 (2.21%)
cusip -> >1 cik                      : 9901 rows
of those, >1 cik with a filing in win: 2800 rows (contested)
contested and NOT settled by coname  : 334 rows
LINKED holder rows                   : 20336 (96.95%)
firms   : 1868 of 1913 permnos linked (97.65%)
firm-yrs: 7350 of 7649 linked (96.09%)
```

FactSet → DEF 14A:

```
fsym_id -> cik: 17497 of 30192 matched (58.0%), 12695 unmatched
filing coverage: 69355 of 95610 DEF 14A 2006-2021 have a FactSet security (72.5%)
sampled 3000 filings (seed 20260928) -> 2647 linked (88.2%)
  dropped, no stake in the +-window   : 322 (10.7%)
  dropped, no shares outstanding      : 31 (1.0%)
```

The 334 contested-and-unsettled blockw rows (1.6%) are the residual mislink
risk; a wrong CIK there scores a correct parse as a miss, so the gate is set
with that noise floor in mind.

## 2. Baseline

Command, verbatim, and its exit code:

```
$ bash run_baseline.sh
== shards ==
shards=13 filings=9968 bytes_min=408.2MB max=408.2MB mean=408.2MB imbalance=0.0%
== array ==   (SGE array 40327587, 13 tasks, 1 slot each, longest task 54 s)
== fetch ==
ownership rows=156750 manifest rows=9968 filelist rows=9968
EXIT=0            # the second run; the first exited 3 on the hash lock, see §5

$ bash check.sh
CHECK_EXIT=1
```

Scored on **dev only** (8,027 gold-linked filings, 2,986 firms):

| metric | baseline | denominator |
|---|---:|---|
| (i) filing yield, ≥1 ownership row | **93.50%** | 7,505 / 8,027 gold-linked dev filings |
| (i) filing yield, ≥1 parsed percent **[gated]** | **83.17%** | 6,676 / 8,027 |
| (ii) holder recall vs blockw **[gated]** | **61.54%** | 8,767 / 14,246 gold holder rows ≥5% |
| (ii) holder precision vs blockw **[gated]** | **63.36%** | 9,038 / 14,264 parsed non-group rows ≥5% |
| (iii) D&O group % vs FactSet insider sum, ≤1 pp **[diagnostic]** | **23.27%** | 406 / 1,745 comparable firm-years |
| (iii) largest block % vs FactSet largest, ≤1 pp **[diagnostic]** | **23.14%** | 463 / 2,001 comparable firm-years |
| (iv) group-row detection **[gated]** | **55.71%** | 3,719 / 6,676 filings with a parsed percent |

Gap distributions for (iii): median |gap| **3.56 pp** and MAD **13.35 pp** for
the D&O group figure; median **7.38 pp**, MAD **16.87 pp** for the largest
block.

Filing presence is 8,027 / 8,027 = 100.00%: every gold-linked dev filing was
read and carries a manifest row, so nothing below is a link failure.

### Decomposition of misses by cause

Denominator = 8,027 gold-linked dev filings, one cause per filing, first
matching cause wins (`miss_dev.tsv` carries the per-filing detail):

| cause | filings | share |
|---|---:|---:|
| `group_row_missing` | 2,337 | 29.11% |
| `ok` | 1,930 | 24.04% |
| `aggregate_gap_multi_class_or_denominator` | 1,412 | 17.59% |
| `name_mismatch` | 908 | 11.31% |
| `table_found_no_percent` | 829 | 10.33% |
| `no_table_found_plain_text` | 487 | 6.07% |
| `percent_mismatch` | 89 | 1.11% |
| `no_table_found_html` | 35 | 0.44% |
| `link_failure_not_in_manifest` | 0 | 0.00% |
| `read_error` | 0 | 0.00% |

And at the holder-row level, the 5,076 blockw gold rows (of 14,246) with no
name match at all:

| the unmatched gold holder is | rows |
|---|---:|
| an institution (FMR, Vanguard, BlackRock, State Street, "… Capital/Management/Advisors", a bank or insurer) | 2,118 |
| in a filing the parser produced no rows for | 897 |
| a trust, foundation or estate | 415 |
| a family entity (Enterprises / Partners / Associates / L.P.) | 308 |

The institutional share is the single most informative number here: those are
5%-holder rows, and 2,118 of them missing says the **5% holders table is often
not reached**, not that names are hard. The r2000 build hit exactly this defect
once (an item-count scan limit cut the 5% window off) and fixed it for its ten
companies; the corpus says the fix was partial.

The family-entity rows are the opposite case and are **not** fully fixable: for
Walmart 2000 blockw records `WALTON ENTERPRISES; L.P.` at 38.07% while the
proxy's own table lists five individual Waltons at 38.13–38.37% and no entity
row (verified with `-debug` on `0000104169-00-000001`). No parser recovers a row
the document does not contain.

## 3. Pass thresholds, and the argument for each

**Exactly four metrics gate.** Filing yield (parsed percent), holder recall vs
blockw, holder precision vs blockw, and group-row detection are the keys under
`minimums` in `thresholds.json`, and `check.sh` exits 0 only when all four clear.

**The two FactSet aggregate metrics are DIAGNOSTIC.** They are computed and
printed with their denominators every round and never affect the exit code,
because the FactSet gold is defined by a **proxy window over all FactSet stakes**
and therefore mixes 13F and Form 4 positions — only **21 of 2,647** linked
firm-years carry the PXY marker (§1). A 1 pp band over a gold set built that way
would reward chasing gold noise rather than parser defects, so the loop is told
not to optimise them.


Literature bar: **Fabisik, Fahlenbrach, Stulz & Taillard** report a ~71% yield
extracting insider ownership from proxies; **Lewellen & Lewellen** report a mean
absolute deviation of **0.3 pp** between FactSet insider ownership and the
proxy. The first is a floor this parser already clears; the second is a ceiling
this measurement cannot reach, and the plan says why rather than pretending
otherwise.

### The four gated metrics

| metric | baseline | threshold | argument |
|---|---:|---:|---|
| filing yield (parsed percent) | 0.8317 | **0.88** | Already 12 pp above Fabisik's 71%. The residual is 10.3% `table_found_no_percent` + 6.5% no-table. A large part of the first group is real — a proxy that states "no person is known to own more than 5%" and gives a share-count-only D&O table has no percent to parse — so 1.00 is not available. 0.88 asks for about a third of the remaining gap, which is the plain-text no-table bucket (6.07%) plus the easier half of the no-percent bucket. |
| holder recall vs blockw | 0.6154 | **0.75** | 2,118 of the 5,076 name-unmatched rows are institutional 5% holders the parser should be reaching, and 897 more sit in filings that produced nothing. Recovering those two buckets alone is worth ~21 pp. The 308 family-entity rows and part of the 415 trust rows are not recoverable, so 0.90 would be a threshold the document text cannot satisfy. |
| holder precision vs blockw | 0.6336 | **0.75** | Precision's denominator is parsed non-group rows ≥5% inside blockw-covered filings. Two known defects inflate it: extra tables attached to the ownership section (401(k), option tables) and multi-class rows whose percent-of-class is compared against blockw's percent-of-common. Both are parser-side and both are fixable; 0.75 pairs with recall so the loop cannot buy one with the other. |
| group-row detection | 0.5571 | **0.80** | The r2000 build measured **84.25%** on its 10-company, 273-filing corpus with the same code, so 0.80 is demonstrably reachable on a corpus with the same era mix; the corpus-wide 55.71% says the ASCII three-line wrap defect (known defect 1) bites much harder at scale than on ten large firms. |

Those four, and only those four, are gated. `check.sh` exits 0 only when every
one of them clears.

### The two diagnostic metrics — printed, never gated

| metric | baseline | denominator | why it is not gated |
|---|---:|---|---|
| D&O group % vs FactSet insider sum, ≤1 pp | 0.2327 | 406 / 1,745 comparable firm-years | Median \|gap\| 3.56 pp, MAD 13.35 pp. The gold is the sum over FactSet natural-person holders inside a 97-day proxy window, so it absorbs 13F- and Form 4-sourced positions the proxy's D&O table never reports. Lewellen & Lewellen's 0.3 pp MAD compares FactSet against a *hand-read* proxy figure; this comparison cannot reach that, and a 1 pp band would pay the loop to fit the window. |
| largest block % vs FactSet largest, ≤1 pp | 0.2314 | 463 / 2,001 comparable firm-years | Median \|gap\| 7.38 pp, MAD 16.87 pp. Same window problem, plus the dual-class denominator (percent-of-class vs percent-of-shares-outstanding), which is the `aggregate_gap_multi_class_or_denominator` bucket at 17.59% of filings. The denominator fix is a real parser improvement and shows up in holder precision, which *is* gated — so the defect is still scored, just not through a 1 pp band on noisy gold. |

Both are recomputed and printed with their denominators on every scoring run, and
the loop's prompt tells it not to optimise them. They are there so a regression in
the aggregates is visible, not so the loop can chase them.

## 4. Commands

**The check** (this, and only this, ends the loop):

```bash
bash /home/eh/projects/workflows/skills/wrds/scripts/parse_def14a_own/check.sh
```

Exit codes: `0` all **four** gated metrics clear, `1` one of the four is short,
`2` no parser output to score, `3` the hash lock does not verify.

The scorer prints two blocks. `== GATED METRICS (4; thresholds ...) ==` carries
`filing_yield_parsed_percent`, `holder_recall_blockw`, `holder_precision_blockw`
and `group_row_detection_rate`, each with `PASS`/`FAIL` against its threshold, and
those four alone decide the exit code. `== DIAGNOSTIC METRICS (2; no threshold, NO
effect on the exit code) ==` carries `group_pct_agreement_factset` and
`largest_block_agreement_factset`; section (iii) above it prints both with their
comparable-firm-year denominators and their median |gap| and MAD. The gated set is
read from the `minimums` keys in `thresholds.json`, so it cannot drift from the
file the lock covers.

**The gate** (cheap, shell-only; while it is red no model call is spent):

```bash
test -f /data/def14a_own/work/out/round-ready
```

`run_baseline.sh` removes that marker when it starts a grid pass and re-creates
it after the fetch and score, so the gate is red exactly while a round is in
flight.

**The launch** (not run):

```bash
setsid nohup bash /home/eh/.claude/skills/workflows/skills/grind/scripts/grind.sh run \
  --journal /data/def14a_own/work/grind.jsonl \
  --prompt-file /home/eh/projects/workflows/skills/wrds/scripts/parse_def14a_own/GRIND_PROMPT.md \
  --check 'bash /home/eh/projects/workflows/skills/wrds/scripts/parse_def14a_own/check.sh' \
  --gate  'test -f /data/def14a_own/work/out/round-ready' \
  --sleep 300 --stall-after 6 --max-iters 120 \
  >/data/def14a_own/work/grind.log 2>&1 </dev/null &
```

Then, from anywhere:

```bash
G=/home/eh/.claude/skills/workflows/skills/grind/scripts/grind.sh
bash $G status  --journal /data/def14a_own/work/grind.jsonl
bash $G tail    --journal /data/def14a_own/work/grind.jsonl -n 40
bash $G floors  --journal /data/def14a_own/work/grind.jsonl
bash $G stop    --journal /data/def14a_own/work/grind.jsonl --why '...'
```

If this session is to act on the result, CronCreate an hourly heartbeat
(`7 * * * *`) in the same turn as the launch and CronDelete it at the ending.

## 5. What the loop may and may not edit

| may edit | must not touch |
|---|---|
| `parse_def14a_own_go/*.go` | `scorer/score.py` |
| `parse_def14a_own_go/*_test.go` | `thresholds.json` |
| `sge/*` (when the run shape itself is wrong) | `lock.sha256` |
| | `/data/def14a_own/gold/**` (all four gold artifacts) |
| | the holdout, by any route |

Enforcement is `lock.sha256`, which `score.py` verifies over six files before it
reads a single row and exits **3** on any mismatch. It is not decoration: the
first `run_baseline.sh` of this session exited 3 because an edit to `score.py`
(changing the holdout refusal from exit 1 to exit 4) had not been re-locked.

```
$ bash run_baseline.sh
LOCK MISMATCH:
  scorer/score.py: lock=3db15fba6cbffa72 actual=896a93d981288a6b
EXIT=3
```

The holdout has a second, independent guard: `score.py --holdout` prints
`REFUSED` and exits **4** whenever `GRIND_ITERATION` is set, which it is for
every iteration.

```
$ GRIND_ITERATION=7 python3 scorer/score.py --holdout --rows ... --manifest ...
REFUSED: --holdout inside a grind iteration (GRIND_ITERATION=7). A loop that can read the holdout has no holdout.
exit=4
```

The holdout is scored **once**, by a human, after the loop ends — and the
difference between the dev and holdout scores is the only evidence that the
parser improved rather than that the loop fitted the dev set.

## 6. Prompt file

`GRIND_PROMPT.md`, in this directory, is the per-iteration prompt. Its shape:
read `GRIND_FLOORS` / `GRIND_SUBJECTS` / `GRIND_NOTES`; pick the largest
non-floored cause out of `miss_dev.tsv`; read 5-10 of those filings with
`-debug`; write the failing test first; fix the parser; re-run `run_baseline.sh`;
record one `progress`, `attempt` or `floor`. It states the edit boundary above,
the "never widen a threshold, never loosen a test" rule, the grid-not-login-node
rule and the determinism requirement, and it hands the agent the exact `append`
lines for the journal.

---

## 7. AMENDMENT — 2026-09-29, the precision round

Supersedes §1 on the holdout and §3 on the precision threshold. Everything below
is a line a command printed on 2026-09-29; the commands are quoted.

### 7.1 Why there is a second round at all

The first grind ran four iterations and cleared all four gates on the
seed-20260928 dev split. The holdout was then scored **once**:

| metric | dev (seed 20260928) | holdout (seed 20260928) | gap |
|---|---:|---:|---:|
| `filing_yield_parsed_percent` | 0.9058 | 0.8985 | 0.0073 |
| `holder_recall_blockw` | 0.8091 | 0.7962 | 0.0129 |
| `holder_precision_blockw` | **0.7843** | **0.7085** | **0.0759** |
| `group_row_detection_rate` | 0.9026 | 0.8968 | 0.0058 |

(`/data/def14a_own/work/metrics_dev.json` as of that run, preserved as
`metrics_holdout_20260928_spent.json` for the holdout column.)

Precision was the only metric with a material generalisation gap, and at a 0.75
dev floor the parser ships around 0.67-0.68 on unseen firms. The journal note
`residue-after-all-gates-pass` also says the remaining precision defects are
**named and layout-shaped**, not exhausted: 3,286 FP candidate rows, with 550 in
the glued-trailing-address family alone.

### 7.2 The holdout was re-drawn — the old one is spent

A holdout that has been scored is no longer a holdout. The seed-20260928 split
is preserved for provenance and is never scored again:

```
/data/def14a_own/gold/holdout_20260928_spent.tsv   sha256 d901aa5f10cc6592…
/data/def14a_own/gold/holdout_20260928_spent.json
/data/def14a_own/work/metrics_holdout_20260928_spent.json
```

```
$ python3 gold/make_holdout.py --seed 20260929
[in ] blockw: 20336 rows, 7321 filings, 1930 ciks
[in ] factset: 2647 rows, 2647 filings, 2130 ciks
[split] seed=20260929 firms=3733 -> holdout=747 (20.0%) dev=2986
[out] /data/def14a_own/gold/gold_filelist.tsv: 9968 filings (7955 dev, 2013 holdout)
[out] /data/def14a_own/gold/holdout.json holdout.tsv sha256=a3a51ea6c90b9f9d09ae922580f77722df5458481ba9111000d0c4e60984e838
EXIT=0
```

**No new grid round was needed for the split.** `gold_filelist.tsv` is the union
of dev and holdout and does not depend on which firms fall where; its sha256 is
`ef22ccd662ac043c5d45e10e5bdf5cc076204e9d011fce5a9bd921c9051ab1f5` before and
after the re-draw, so the parser output on disk already covers all 9,968
filings. The scorer's manifest counts confirm it: 7,955 dev + 2,013 holdout =
9,968.

**The re-drawn holdout is not clean, and this is the one caveat that matters.**
Of its 747 firms, **152 were in the seed-20260928 holdout and 595 were in the
seed-20260928 DEV set** — the parser has already been tuned against those 595.
The pre-round holdout number in §7.4 is therefore biased upward and is a
*baseline for the round*, not a clean generalisation estimate. The only clean
read the project will ever get again is the seed-20260928 holdout in §7.1.

### 7.3 Thresholds

| metric | old minimum | new minimum |
|---|---:|---:|
| `filing_yield_parsed_percent` | 0.88 | 0.88 (unchanged) |
| `holder_recall_blockw` | 0.75 | 0.75 (unchanged) |
| `holder_precision_blockw` | 0.75 | **0.82** |
| `group_row_detection_rate` | 0.80 | 0.80 (unchanged) |

The three unchanged gates are the guard: a "precision fix" that suppresses rows
drives recall under 0.75 and `check.sh` still exits 1, so precision cannot be
bought with recall. The FactSet pair stays diagnostic, for the reason in §3.

### 7.4 Pre-round baseline, on the NEW split, on unchanged parser output

`bash check.sh` — **exit 1**, as expected, precision short:

| metric | dev (seed 20260929) | numerator / denominator | vs 0.82 / other minima |
|---|---:|---|---|
| `filing_yield_parsed_percent` | **0.9001** | 7,160 / 7,955 gold-linked dev filings | PASS |
| `holder_recall_blockw` | **0.8066** | 11,268 / 13,969 gold holder rows ≥5% | PASS |
| `holder_precision_blockw` | **0.7636** | 11,669 / 15,281 parsed non-group rows ≥5% | **FAIL** |
| `group_row_detection_rate` | **0.9024** | 6,461 / 7,160 filings with a parsed percent | PASS |
| `group_pct_agreement_factset` | 0.2280 | 417 / 1,829 comparable firm-years | diagnostic |
| `largest_block_agreement_factset` | 0.2387 | 479 / 2,007 comparable firm-years | diagnostic |

`score.py --holdout` scored **once**, exit 0, written to
`/data/def14a_own/work/metrics_holdout_pre_20260929.json`:

| metric | holdout (seed 20260929) | numerator / denominator |
|---|---:|---|
| `filing_yield_parsed_percent` | **0.9215** | 1,855 / 2,013 |
| `holder_recall_blockw` | **0.8068** | 2,935 / 3,638 |
| `holder_precision_blockw` | **0.7899** | 3,031 / 3,837 |
| `group_row_detection_rate` | **0.8981** | 1,666 / 1,855 |
| `group_pct_agreement_factset` | 0.2579 | 123 / 477 |
| `largest_block_agreement_factset` | 0.2618 | 133 / 508 |

**The finding that cuts against §7.1, stated rather than buried.** On the new
split the holdout scored precision **0.7899 against dev 0.7636** — 0.0263
*above* dev, the opposite sign to the 0.0759 gap that motivated raising the
threshold. Most of that first gap was a draw effect: one 747-firm draw is a
noisy estimate of generalisation, and two draws with opposite signs are not a
trend. The upward bias described in §7.2 (595 previously-dev firms) pushes this
number the same way. **0.82 is retained, but on the narrower argument** that
precision is the weakest of the four gates by 4 pp and that the residual FP
families are named, layout-shaped and countable — not on the
generalisation-gap argument, which this measurement does not support.

### 7.5 Guards re-verified after the re-lock

```
$ bash make_lock.sh                       # EXIT=0, 6 files, holdout.tsv -> a3a51ea6…
$ sha256sum -c …                          # all six OK, exit 0
$ bash check.sh                           # [lock] verified over 6 files; CHECK_EXIT=1
$ GRIND_ITERATION=1 python3 scorer/score.py --holdout …
REFUSED: --holdout inside a grind iteration (GRIND_ITERATION=1). A loop that can read the holdout has no holdout.
REFUSAL_EXIT=4       # and no --json-out file was written
$ ls /data/def14a_own/work/out/round-ready   # present, the output is current
```
