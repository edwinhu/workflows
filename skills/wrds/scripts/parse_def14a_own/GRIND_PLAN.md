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

---

## 8. AMENDMENT — 2026-09-29, a MODERN-ERA yardstick (ISS directors). **ITEM 1 ADOPTED 2026-09-29; ITEMS 2-4 STAND AS WRITTEN. ROUND CLOSED 2026-09-29 — see §8.5B for the result and the step-2 reset to 0.82.**

Adds a third gold set and four metrics. As first written (earlier on 2026-09-29)
all four were **DIAGNOSTIC** and `minimums` was unchanged; §8.5 was a *proposal*.
**Item 1 of that proposal was ADOPTED later the same day** — see §8.5A — so
`iss_director_recall` is now a **GATED** metric and the gated count is **five**.
Items 2, 3 and 4 were not adopted: (b) and (c) remain diagnostic and the ISS
split remains its own file. Every number below is a line a command printed on
2026-09-29; the commands are quoted.

### 8.1 Why

Both existing holder-level gates are pre-2002. `blockw` spans 1996-2001 and is
the only gold set with a per-holder percent; the two FactSet metrics are
firm-level, diagnostic, and agree with the parser only 22-24% of the time. So
2002-2024 HTML proxies — the majority of the corpus and all of the modern layout
families — were validated by nothing holder-level. ISS Directors closes that:
a per-director share count and voting-power percent stamped with the proxy's own
`meetingdate`.

### 8.2 The gold set

`gold/build_gold_iss.py` → `gold_iss_all.tsv.gz`, then `gold/sample_gold_iss.py`
→ `gold_iss.tsv.gz` (sampled) + `holdout_iss.tsv`.

| source | span | rows in | cusip |
|---|---|---:|---|
| `risk_directors.rmdirectors` | 2007-2024 | 255,268 | 9-char as-delivered |
| `risk_directors.directors` (legacy, links cleanly) | 2002-2006 | 68,065 | 6-char header |

Grain out: one row per (company, meeting, director). 323,238 rows after dropping
95 byte-duplicates on `(iss_table, cusip, meetingdate, fullname)`.

**What ISS does not carry, so the scorer must not read its absence as a miss:** no
D&O group row, no non-director 5% blockholder, and no executive officer who is not
a director (verified in `r2000/scratch/ownership_sources.md` §2, which also records
that ISS's universe is the S&P 1500 only).

### 8.3 The 100x `num_of_shares` defect is detected and flagged, never used

`ownership_sources.md` §2 documents Walmart rows whose `num_of_shares` is low by
~100x. The detector is external, because within a meeting both wrong rows agree
with each other: CRSP `msf.shrout` at the last month-end on or before
`meetingdate` gives shares outstanding, and the row's own
`pcnt_ctrl_votingpower` implies a share count to compare against.

```
flag_shares_100x     pcnt >= 1.0 and shares / (pcnt/100 * shrout) < 0.05
flag_shares_gt_out   shares > 1.05 * shrout
flag_no_shares       num_of_shares null or 0
```

Measured over 315,873 linked rows: `flag_shares_100x` **145**, `flag_shares_gt_out`
**67**, `flag_no_shares` **23,400**, any flag **23,612 (7.48%)**. shrout was
unavailable for 4,598 rows (1.46%). Inspected: the flag fires on every
`rmdirectors` Walton row 2007-2024 and on `JOHN T WALTON` 2004 (11,965,088 against
an implied 1,700,492,547 — a 142x error), and does **not** fire on the correct
2002/2003/2005/2006 legacy Walton rows. Flagged rows are excluded from the
denominator of every ISS metric.

### 8.4 Link rates, sample and split — printed by the builders

ISS → DEF 14A, denominator 323,238 deduped ISS director rows, filing date in
`[meetingdate-120d, meetingdate-7d]`:

```
dropped, no cusip on the ISS row     : 0 (0.00%)
dropped, cusip not in wciklink_cusip : 2750 (0.85%)
dropped, no DEF 14A in the window    : 4615 (1.43%)
cusip -> >1 cik                      : 147567 rows
of those, >1 cik with a filing in win: 42972 rows (contested)
contested and NOT settled by coname  : 3299 rows
LINKED director rows                 : 315873 (97.72%)
meetings: 33516 of 34249 linked (97.86%)
distinct DEF 14A filings linked      : 33409    distinct CIKs: 3230
```

The 3,299 contested-and-unsettled rows (1.02%) are the residual mislink risk, the
same class as blockw's 1.6%.

Sample: 3,000 of the 33,409 linked filings, stratified by ISS proxy year over
2002-2024 (proportional + largest remainder, 109-137 per year), seed **20260929**
→ 28,547 director rows over 1,714 firms; 2,202 rows flagged.

Split at the FIRM level, seed **20260930**, with a forced core: 385 of the 1,714
ISS firms are `holdout` in `holdout_20260928_spent.tsv` or in `holdout.tsv`, and
all 385 go to the ISS holdout so no spent firm is scored as ISS dev. 385 is already
**22.46%** of 1,714, above the 20% target, so the fresh draw added **0** firms.
Result: 2,259 dev filings / 741 holdout filings.

### 8.5 Baseline on ISS-dev, and the PROPOSAL

`bash check.sh` → **exit 0**, the four gated metrics bit-for-bit unchanged
(0.8921 / 0.7873 / 0.8304 / 0.9067). ISS-dev, 2,259 filings, 19,586 non-flagged
director rows:

| metric | value | numerator / denominator |
|---|---:|---|
| (a) `iss_director_recall` | **0.8683** | 17,007 / 19,586 non-flagged ISS director rows |
| (b) `iss_share_agreement_1pct` | **0.7666** | 12,739 / 16,617 matched rows with both counts |
| (b) `iss_share_agreement_5pct` | **0.7804** | 12,968 / 16,617 |
| (c) `iss_individual_precision_proxy` | **0.9726** | 29,939 / 30,783 person-shaped rows |

By era — and the era table is the whole argument:

| era | (a) recall | (b) within 1% | (c) proxy | (b) parsed **>** ISS | (b) parsed **<** ISS |
|---|---:|---:|---:|---:|---:|
| 2002-2006 | 82.81% (4,009) | 84.74% (3,276) | 96.79% (5,677) | 3.27% | 12.00% |
| 2007-2012 | 88.31% (5,219) | 83.20% (4,477) | 97.35% (7,994) | 1.65% | 15.14% |
| 2013-2018 | 86.56% (5,409) | 85.69% (4,577) | 96.51% (8,575) | 3.36% | 10.95% |
| 2019-2024 | 88.83% (4,949) | **54.02%** (4,287) | 98.23% (8,537) | **40.42%** | 5.55% |

**PROPOSAL.** (Item 1 **ADOPTED 2026-09-29**, with the two-step in §8.5A; items
2, 3 and 4 stand as written and were **not** adopted.)

1. **GATE (a) `iss_director_recall` at 0.82.** — **ADOPTED 2026-09-29.** It is stable across all four eras
   (82.8-88.8%), its denominator is large, and its misses are parser-shaped: 670
   `table_truncated` + 304 `no_table` + 1,605 `name_not_found` = 2,579 of 19,586.
   0.82 sits just below the weakest era, so no era can be traded against another;
   it is a no-regression floor, not a stretch. This is the one metric in the set
   that would actually give 2002-2024 a holder-level gate.
2. **DO NOT gate (b) `iss_share_agreement_*`.** The 2019-2024 collapse is almost
   entirely **upward** — 40.42% of matched rows parse a LARGER count than ISS,
   against 5.55% smaller — and the median ratio is exactly 1.0000 in every era.
   Inspected: `0001558370-21-002589` (Hawaiian Electric) adds a constant **+3,664**
   to every director, which is a footnote-disclosed add-on (options exercisable
   within 60 days / deferred units) that the proxy's beneficial-ownership total
   includes and ISS's count excludes. That is a definitional gap in the gold, not a
   parser defect, and a 1% band would pay the loop to drop the add-on and get the
   proxy's own total wrong. Keep it diagnostic. If a share-count gate is ever
   wanted, the defensible form is **one-sided** (penalise only parsed < ISS), and
   that variant must be specified and locked before it is measured, not chosen
   after seeing this table.
3. **DO NOT gate (c) `iss_individual_precision_proxy`.** At 0.9726 with 37.92% of
   the numerator coming from the officer-allowance arm, it has almost no headroom
   and cannot separate a real officer from a person-shaped mis-parse in the same
   table. It is a sanity bound; `holder_precision_blockw` remains the precision
   gate.

Applying (1) would require a re-lock and a fresh `_history` entry in
`thresholds.json`. Both were done on 2026-09-29 — see §8.5A.

### 8.5A ADOPTION of item 1 — 2026-09-29, in TWO STEPS

Item 1 above is **ADOPTED**. `iss_director_recall` moved out of `diagnostics` and
into `minimums`, so **five** metrics now gate `check.sh`. The adoption is
deliberately two-step, and the second step is not optional:

| step | when | `iss_director_recall` minimum | what it is |
|---|---|---:|---|
| **1** | **now**, the ISS round | **0.90** | a ROUND TARGET, 0.0317 above the 0.8683 baseline. `check.sh` exits 1 until the parser closes the gap. |
| **2** | **DONE 2026-09-29**, §8.5B | **0.82** | the PERMANENT no-regression floor argued in item 1 — just below the weakest era (2002-2006 at 0.8281). This is the value live in `minimums` now. |

**0.90 is not a floor and must not be left in place.** A floor is a value an
honest later change cannot fall through; 0.90 is above every era's current recall
and would make the gate unreachable for a change that legitimately trades a
little ISS recall for something else. Step 2 is what item 1 actually argued for;
step 1 is the round's target, aimed at the two largest parser-shaped miss causes
in §8.6 — `name_not_found` (1,605 rows, 8.19%) and `table_truncated` (670, 3.42%),
with `no_table` (304, 1.55%) and `name_found_no_share_count_parsed` (390, 1.99%)
behind them. Together those are 2,969 rows against 19,586, so closing roughly two
thirds of `name_not_found` + `table_truncated` reaches 0.90.

Items 2, 3 and 4 are **unchanged and not adopted**: `iss_share_agreement_1pct`,
`iss_share_agreement_5pct` and `iss_individual_precision_proxy` stay under
`diagnostics`, and `holdout_iss.tsv` stays a separate split file.

Guards that came with the adoption:

- The four existing minimums are byte-for-byte unchanged (0.88 / 0.75 / 0.82 /
  0.80), so ISS recall cannot be bought by flooding tables with rows — a change
  that lifts recall by emitting more candidates drives `holder_precision_blockw`
  under 0.82 and `check.sh` still exits 1.
- `score.py` aborts with **exit 2** when the parser output does not cover the ISS
  gold filings, and refuses `--no-iss` while the metric is gated. A gated recall
  over a denominator the round itself chose is not a measurement.
- `run_baseline.sh` now defaults to `gold_filelist_all.tsv` and asserts, before
  submitting, that the filelist covers **both** `gold_filelist.tsv` and
  `gold_iss_filelist.tsv`; it also re-creates `out/round-ready` even when the
  scorer reports a gated metric short.
- Re-locked: `thresholds.json` and `scorer/score.py` hashes changed in
  `lock.sha256`; the six gold hashes did not.

### 8.5B RESULT — 2026-09-29, the round CLOSED and step 2 taken

The ISS round ended with `check.sh` green at **iteration 7**, commit `e3864f83`.
Step 2 of §8.5A is done: `iss_director_recall` in `minimums` is **0.82**, the
permanent no-regression floor, not 0.90. A dated `_history` entry in
`thresholds.json` carries the same numbers, and the file was re-locked.

Dev, 2,259 ISS filings / 19,586 non-flagged director rows (`metrics_dev.json`):

| gated metric | minimum | value |
|---|---:|---:|
| `iss_director_recall` | 0.82 (was 0.90 for the round) | **0.9135** |
| `filing_yield_parsed_percent` | 0.88 | 0.8921 |
| `holder_recall_blockw` | 0.75 | 0.7871 |
| `holder_precision_blockw` | 0.82 | 0.8301 |
| `group_row_detection_rate` | 0.80 | 0.9067 |

ISS **holdout**, 741 filings / 6,759 non-flagged director rows, scored pre and
post on the same split (`metrics_iss_holdout_pre_20260929.json`,
`metrics_iss_holdout_post_20260929.json`):

| metric | pre | post | delta |
|---|---:|---:|---:|
| `iss_director_recall` (GATED) | 0.8735 | **0.9130** | +0.0395 |
| `iss_share_agreement_1pct` (diag) | 0.7666 | 0.7687 | +0.0021 |
| `iss_individual_precision_proxy` (diag) | 0.9733 | 0.9840 | +0.0107 |

**It generalised.** The holdout gained +0.0395 against +0.0452 on dev, so the
recall was not bought from the dev split; the precision proxy rose rather than
fell and 1% share agreement was flat, so the new hits are not person-shaped
noise flooding the tables. 0.9130 on the holdout leaves 0.0930 of margin over
the 0.82 floor — which is what makes 0.82 a floor and not a target.

**ALL THREE HOLDOUTS ARE NOW SPENT** and must not be scored again:
`holdout_20260928_spent.tsv` (blockw, seed 20260928), `holdout.tsv` (blockw,
seed 20260929, spent by the precision round) and `holdout_iss.tsv` (ISS, seed
20260930, spent by this round — scored pre AND post on 2026-09-29). A number
from any of the three is a dev number from here on, whatever the file is called.
A future round that wants an honest generalisation estimate must draw a fresh
split first.

### 8.6 (a) miss decomposition, denominator 19,586 non-flagged ISS director rows — PRE-ROUND

| cause | rows | share | 5 example accessions |
|---|---:|---:|---|
| `ok` | 12,968 | 66.21% | 0001193125-09-079686, 0001564590-22-011393, 0000950135-04-001474, 0001193125-16-526969, 0001193125-17-100897 |
| `name_found_shares_off` | 3,649 | 18.63% | 0001047469-07-007359, 0001047469-13-009333, 0001003078-21-000251, 0001193125-08-060724, 0001193125-13-109098 |
| `name_not_found` | 1,605 | 8.19% | 0001193125-19-097303, 0001047469-07-007359, 0001047469-13-009333, 0000950152-05-002111, 0001144204-08-016722 |
| `table_truncated` | 670 | 3.42% | 0001000229-17-000042, 0001193125-18-092158, 0001193125-23-077360, 0000930413-02-001113, 0001206774-05-000564 |
| `name_found_no_share_count_parsed` | 390 | 1.99% | 0000950152-05-002111, 0000950134-08-004455, 0000950123-11-033213, 0001308179-23-000452, 0000950123-11-028696 |
| `no_table` | 304 | 1.55% | 0000950123-09-005010, 0001193125-10-059627, 0001042046-04-000021, 0001308179-20-000107, 0001113169-02-000001 |

`ok` and `name_found_shares_off` are both (a) HITS: (a) is a name-only recall, so a
found director with a wrong share count is not an (a) miss. The (a) misses are
`no_table` + `table_truncated` + `name_not_found` = 2,579 (13.17%).

### 8.7 Guards after the re-lock

`lock.sha256` now covers **8** files — the two new ones are `gold/gold_iss.tsv.gz`
and `gold/holdout_iss.tsv`, so the loop cannot edit the ISS gold either.
`score.py --iss-holdout` has the same `GRIND_ITERATION` refusal as `--holdout`
(exit 4, no `--json-out` written). ~~The ISS holdout has **not** been scored.~~
**Superseded 2026-09-29 (§8.5B): the ISS holdout has now been scored twice — the
pre-round baseline and the post-round result — and is SPENT, as are both blockw
holdouts.**

### 8.8 What the loop may and may not edit — additions to §5

| may edit | must not touch |
|---|---|
| (unchanged) | `gold/gold_iss.tsv.gz`, `gold/holdout_iss.tsv`, the ISS holdout by any route |
