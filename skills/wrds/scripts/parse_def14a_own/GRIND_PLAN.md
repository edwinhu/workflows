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

---

## 9. AMENDMENT — 2026-09-29, the DUPLICATE-ROW round (setup)

Adds a THIRD ruler and THREE gates; the gated count goes 5 → 8. Every number
below is a line a command printed on 2026-09-29 and the commands are quoted in
`~/projects/r2000/scratch/def14a_dup_setup.md`.

### 9.1 Why

The full-archive run (207,912 DEF 14A, commit `e4e78a95`) found 261,460 exact-key
duplicate rows on `(accession, cik, holder_name, share_class)` — **9.00%** of
2,903,798 rows, 32.65% in 2009, ~17-20% in 2017 / 2018 / 2024 — while 248 of 250
hand-checked holder/share/percent triples were exact. The values are right and the
rows are over-emitted, and **not one of the five existing gates can see it**: all
five score gold-linked filings only, and blockw (1996-2001), FactSet (2006-2021)
and ISS (2002-2024) are vendor coverage of larger filers that never reaches
1994-1995 or 2025-2026.

### 9.2 DIAGNOSIS FIRST — the split, measured before any threshold was written

duckdb over all 33 `rows_<year>.tsv.gz`. The excess decomposes exactly, because
within one key group `n-1 = Σ_kinds(n_in_kind−1) + (n_kinds−1)`:

| family | rows | % of 2,903,798 |
|---|---:|---:|
| excess TOTAL | 261,460 | 9.004% |
| (i) **SAME `table_kind`** — over-emission | **244,792** | **8.430%** |
| … of which, inside ONE `table_index` | 125,576 | 4.324% |
| … of which, across `table_index` of the same kind | 119,216 | 4.106% |
| (ii) **CROSS `table_kind`** — the 5% table AND the management table | 16,668 | 0.574% |

Cross-kind is the legitimate case the brief named, and it is **0.574%**, so it
explains almost none of the 9.00%. **(i) is 8.43%, far above the 1.0% gate, so the
round is warranted** — the alternative outcome the brief asked about (i already
below the gate) did not occur.

Concentration, measured: only **21,592 of 185,111** filings with any row carry any
same-kind excess (11.7%), and the top 1,000 filings carry **133,534 of 244,792**
(54.6%).

**Co-registrant multiplication inflates the per-year rates and is BY DESIGN.**
1,798 accessions are filed under more than one CIK and the panel grain is
`(cik, accession)`. Counting each accession once instead of once per CIK: 2018 is
18,165 → **4,718**, 2024 18,332 → **4,861**, 2017 14,994 → **4,428**, 2009 48,690
→ **30,493**. The loop is told not to "fix" this.

### 9.3 Mechanisms, from `-debug` on 12 of the worst 2009 / 2018 / 2024 filings

The fingerprint is decisive: **108,592 of the 125,576 within-one-table excess rows
(86.5%) carry `share_class=""`**, and 59,969 of them carry DIFFERING `shares`. The
rows are mostly not spurious — the **grain is broken**, because the class or series
identity of a value column is never carried into `share_class`.

| # | mechanism | example |
|---|---|---|
| M1 | multi-class value columns, `share_class` left empty (multi-level header names the class; `Total` and `combined voting power` columns get no label at all) | `0001193125-18-126922`, `0001258602-24-000028` |
| M2 | a row-level `Title of Class` / `Title of Series` column roled `other` (class lost) or roled `name` (`holder_name` becomes `Admiral Shares`) | `0001104659-24-052085`, `0001683863-24-008416` |
| M3 | non-ownership tables attached once per fund in a fund-family proxy — director COMPENSATION dollars read as `shares` — TRUE over-emission | `0000051931-09-000935`, `0000051931-18-000890` |
| M4 | per-fund 5% record-holder tables: Schwab really is a 5% holder of 200 funds, but the fund identity is never captured | `0000719451-09-000023`, `0000932471-09-000972` |
| M5 | the ASCII text path glues the fund-class label onto the holder name | `0000932471-09-000972` |

So the fix is to **populate `share_class`** (M1, M2, M4, M5) and to **reject the
table** (M3) — never to dedup at emit time, which would throw away a real
per-series holding.

### 9.4 The new ruler: a fixed full-archive sample

`gold/sample_full_archive.py` → `gold/sample_full.tsv`, **8,250 filings, 250 per
filing year 1994-2026**, seed `20260929` (one RNG per year, `seed*1000+year`, pool
sorted by `(accession, cik)`), every gold-linked accession excluded, 17.46 GB.
sha256 `1db737f5b86a64d7…`, reproduced byte-identically on a second run. It is
covered by `lock.sha256` (now **9** files), so the loop cannot re-draw it.

`round_filelist.tsv` (gold ∪ ISS ∪ sample, **21,128** filings, 32.25 GB) is what
`run_baseline.sh` submits, and it asserts coverage of all three before submitting;
`score.py` exits **2** if the output does not cover the sample. `submit_shards.sh`
went to `m_mem_free=16G` / `CONCURRENCY=4` because the sample reaches 2023-2026
and carries filings up to 151.7 MB.

### 9.5 Thresholds — fixed BEFORE the loop

> **SUPERSEDED IN PART by §10 (2026-09-29).** The two ceilings named in the table
> below are DIAGNOSTIC now; the gate moved to the identical-row key at the same
> 0.01 / 0.02. The arguments for the VALUES stand and are why §10 kept them.

`thresholds.json` gains a `maximums` block; `score.py` gates `minimums` as floors
and `maximums` as ceilings, and nothing else.

| metric | kind | threshold | argument |
|---|---|---:|---|
| `sample_dup_excess_same_table_rate` | ceiling | **0.01** | (i) is 8.43% panel-wide / 8.650% on the sample. 86.5% of it has one root cause (empty `share_class`) and 54.6% sits in 1,000 filings, so 1.0% asks for the named mechanisms and not for a suppression rule. |
| `sample_dup_excess_same_table_rate_max_year` | ceiling | **0.02** | Pooling hides 2009 (32.2% on the sample), 2007 (24.8%), 2018 (20.1%), 2024 (14.0%). A per-year ceiling stops one clean era paying for a broken one. |
| `sample_yield_worst_year_margin` | floor | **0.0** | margin = min over years of (yield − floor), floor = the HEAD value minus 0.005, recorded per year in `_sample_yield_floor_by_year`. This is the guard that makes the ceilings unreachable by deleting rows. |
| the five existing gates | floor | 0.88 / 0.75 / 0.82 / 0.80 / 0.82 | unchanged, byte-for-byte |

**Cross-`table_kind` excess is REPORTED, never gated**, with
`sample_dup_excess_total_rate`, `sample_dup_excess_same_table_index_rate`,
`sample_filing_yield_parsed_percent` and `sample_group_row_rate`, plus the per-year
table in `$DEF14A_WORK/sample_by_year.tsv`. Gating it would pay the loop to
suppress a disclosure the document actually makes.

### 9.6 A scorer bug found and fixed during setup

Every TSV in this project is written with a bare `"\t".join(...)`, so nothing is
quoted — but `csv.DictReader`'s default `QUOTE_MINIMAL` mis-reads any field that
BEGINS with a double quote (`"Independent" Directors1`), swallowing the following
tabs and newlines. Measured on the panel: **114,686 rows read against 115,061
present** in the sample filings, 375 lost plus corrupted neighbours. `score.py`
now reads with `QUOTE_NONE`, and its counts agree with an independent duckdb pass
to the row: 115,061 / 10,591 / 9,953 / 638 / 4,662.

The fix does **not** move the five existing gates. Scored over the panel, post-fix:
`filing_yield_parsed_percent` 0.8921, `holder_recall_blockw` 0.7871,
`holder_precision_blockw` 0.8301, `group_row_detection_rate` 0.9067,
`iss_director_recall` 0.9135 — the values already recorded in §8.5B. (Pre-fix the
same command gave 0.8856 / 0.7797 / 0.8296 / 0.9082 / 0.9131.) `csv.field_size_limit`
was also raised: a mis-roled table can put a whole paragraph in `holder_name` and
the 128 KiB default aborted the scorer outright.

## 10. AMENDMENT — 2026-09-29, the gated DUPLICATE METRIC is REDEFINED (operator decision, mid-round)

### 10.1 The change

`maximums` gates two new keys, at the **same thresholds**:

| metric | kind | threshold | status |
|---|---|---:|---|
| `sample_dup_excess_identical_row_rate` | ceiling | **0.01** | GATED as of this amendment |
| `sample_dup_excess_identical_row_rate_max_year` | ceiling | **0.02** | GATED as of this amendment |
| `sample_dup_excess_same_table_rate` | — | — | was gated at 0.01, now **DIAGNOSTIC** |
| `sample_dup_excess_same_table_rate_max_year` | — | — | was gated at 0.02, now **DIAGNOSTIC** |

Everything else is untouched: the six `minimums` (0.88 / 0.75 / 0.82 / 0.80 / 0.82
/ 0.0) and all 33 entries of `_sample_yield_floor_by_year` are byte-for-byte as
they were, and the gated count stays **eight**.

**Old definition.** Excess rows sharing `(accession, cik, holder_name,
share_class)` within one `table_kind`.

**New definition.** Excess COPIES of an **identical row**:

```
(accession, cik, table_kind, holder_name, share_class, shares, percent)
```

`shares` and `percent` compare as the parser emitted them — a row emitted twice by
one parse emits byte-identical numbers. `table_index` is deliberately **out** of
the key, so one row emitted from two tables of the same kind still counts.

### 10.2 Why — the old key counted distinct rows as duplicates

One holder listed once per managed account, each row carrying its **own** shares
and percent, collapses onto `(holder, class, kind)`. AllianceBernstein's 2018 proxy
is the type case: **264 of that year's 304 remaining excess rows**, and **620 of
the 4,352** excess rows remaining across the whole sample.

The loop had already proved this from the inside. Two journal floors were recorded
against exactly this shape —

- `one-record-holder-many-accounts-one-fund-class`
- `sample_dup_excess_same_table_rate_max_year-2018-unreachable`

— the second of which says the 2018 ceiling could not be reached **without
deleting true rows**. A gate that can only be cleared by deleting true rows is a
defect in the metric, not in the parser. An identical row is a duplicate under any
reading, so the new key admits no such floor. **Both floors are superseded by this
section** and by the journal note `operator-dup-metric-identical-row`.

### 10.3 The old measure is kept, as a diagnostic

`sample_dup_excess_same_table_rate` and `_max_year` are still computed and printed
every round, beside the gated pair, so the redefinition is visible rather than
being a silently easier gate:

- `== (vi) FULL-ARCHIVE SAMPLE ==` prints the identical-row excess as `[GATED]` and
  the total / same-kind / same-table_index / cross-kind decomposition as
  `[DIAGNOSTIC]`;
- the per-year table prints `dup_ident` and `dup_same` side by side, and names the
  worst year for each;
- `sample_by_year.tsv` gains `excess_identical_row` and `dup_identical_row_rate`;
- `metrics_dev.json` carries both, and `thresholds.json.diagnostics` lists the two
  demoted keys explicitly.

### 10.4 Implementation and test

`scorer/score.py` grows a `DupExcess` class: **one** streaming accumulator feeding
all five counters, so the definition the unit test exercises is the definition
`main()` scores. `scorer/score_test.py::DupExcessCounters` covers the decision
directly — the AllianceBernstein shape (one holder, nine accounts, distinct shares
and percent) is **not** a duplicate while the old measure calls it eight; an exact
repeat **is** one; three exact copies are two excess; an exact repeat across
`table_index` still counts; a cross-`table_kind` listing does not; the Liberty
Media multi-series shape with `share_class=""` and distinct shares does not; same
shares with different percent does not; and identical rows in two different filings
do not.

### 10.5 The guard is unchanged and still binds

The identical-row ceilings can still be cleared by suppressing rows, and
suppression drives `holder_recall_blockw` under 0.75, `iss_director_recall` under
0.82, `filing_yield_parsed_percent` under 0.88, or one sample year's yield under
its recorded floor. Widening the duplicate definition does not touch that argument.
It only stops the ceiling from **paying** for the suppression of rows that were
never duplicates.

### 10.6 RE-BASELINE — measured 2026-09-29, one full round at HEAD (commit 4c1c94f1)

Commands, in order, all exit 0:

```bash
python3 scorer/score_test.py                      # 19 tests OK
bash make_lock.sh                                 # scorer/score.py + thresholds.json rehashed
env -u GRIND_ITERATION bash run_baseline.sh        # 83 shards, 336,807 ownership rows, 21,128 manifest rows
bash check.sh                                     # CHECK PASS: all 8 gated metrics clear
```

The round parsed the identical filelist as the pre-change round (`round_filelist.tsv`,
21,128 filings; 127,744 parser rows in the 8,250 sample filings) and reproduced the
OLD counters to the row in every year — so the table below isolates the definition
change and nothing else.

**Gated metrics after the change — `check.sh` exit 0:**

| gated metric | value | threshold | |
|---|---:|---:|---|
| `filing_yield_parsed_percent` | 0.8931 | ≥ 0.8800 | PASS |
| `holder_recall_blockw` | 0.7870 | ≥ 0.7500 | PASS |
| `holder_precision_blockw` | 0.8299 | ≥ 0.8200 | PASS |
| `group_row_detection_rate` | 0.9029 | ≥ 0.8000 | PASS |
| `iss_director_recall` | 0.9022 | ≥ 0.8200 | PASS |
| `sample_yield_worst_year_margin` | 0.0010 | ≥ 0.0000 | PASS |
| `sample_dup_excess_identical_row_rate` | **0.0025** | ≤ 0.0100 | **PASS** |
| `sample_dup_excess_identical_row_rate_max_year` | **0.0117** (2006) | ≤ 0.0200 | **PASS** |

The two demoted keys, now diagnostic: `sample_dup_excess_same_table_rate` 0.0192 and
`_max_year` 0.0647 (2018) — the values that were FAILING as gates immediately before
this change. So the round that was stuck is now green, and the number that was stuck
is still printed.

**Old vs new, per filing year, denominator = parser rows in that year's sample filings:**

| year | rows | OLD `dup_same_table_rate` | excess (old) | NEW `dup_identical_row_rate` | excess (new) | rows no longer counted |
|---:|---:|---:|---:|---:|---:|---:|
| 1994 | 2839 | 2.5009% | 71 | 0.2466% | 7 | 64 |
| 1995 | 2419 | 1.7363% | 42 | 0.1654% | 4 | 38 |
| 1996 | 2279 | 3.4226% | 78 | 0.2633% | 6 | 72 |
| 1997 | 2535 | 3.9053% | 99 | 0.5917% | 15 | 84 |
| 1998 | 2597 | 3.2345% | 84 | 0.0770% | 2 | 82 |
| 1999 | 2653 | 1.6208% | 43 | 0.0754% | 2 | 41 |
| 2000 | 2744 | 2.7697% | 76 | 0.3644% | 10 | 66 |
| 2001 | 2872 | 2.6114% | 75 | 0.4526% | 13 | 62 |
| 2002 | 2821 | 2.2687% | 64 | 0.4608% | 13 | 51 |
| 2003 | 3126 | 0.8317% | 26 | 0.0640% | 2 | 24 |
| 2004 | 3167 | 1.4525% | 46 | 0.1895% | 6 | 40 |
| 2005 | 2837 | 1.6567% | 47 | 0.1762% | 5 | 42 |
| 2006 | 3327 | 4.2381% | 141 | 1.1722% | 39 | 102 |
| 2007 | 4759 | 2.7737% | 132 | 0.3362% | 16 | 116 |
| 2008 | 4560 | 1.4254% | 65 | 0.7237% | 33 | 32 |
| 2009 | 5931 | 1.5849% | 94 | 0.1517% | 9 | 85 |
| 2010 | 4145 | 0.7961% | 33 | 0.1930% | 8 | 25 |
| 2011 | 4437 | 0.9015% | 40 | 0.1803% | 8 | 32 |
| 2012 | 6009 | 0.6823% | 41 | 0.0666% | 4 | 37 |
| 2013 | 3436 | 1.1932% | 41 | 0.0873% | 3 | 38 |
| 2014 | 3510 | 0.6838% | 24 | 0.0285% | 1 | 23 |
| 2015 | 4346 | 1.4956% | 65 | 0.5522% | 24 | 41 |
| 2016 | 4231 | 0.8981% | 38 | 0.0945% | 4 | 34 |
| 2017 | 5720 | 1.9231% | 110 | 0.1049% | 6 | 104 |
| 2018 | 4639 | 6.4669% | 300 | 0.0431% | 2 | 298 |
| 2019 | 4183 | 1.6017% | 67 | 0.4542% | 19 | 48 |
| 2020 | 5063 | 1.1456% | 58 | 0.0790% | 4 | 54 |
| 2021 | 3542 | 1.7787% | 63 | 0.2823% | 10 | 53 |
| 2022 | 4885 | 0.8598% | 42 | 0.0614% | 3 | 39 |
| 2023 | 3968 | 2.4950% | 99 | 0.0756% | 3 | 96 |
| 2024 | 5971 | 2.1939% | 131 | 0.1172% | 7 | 124 |
| 2025 | 4276 | 1.7306% | 74 | 0.3976% | 17 | 57 |
| 2026 | 3917 | 0.9957% | 39 | 0.2808% | 11 | 28 |
| **pooled** | **127744** | **1.9163%** | **2448** | **0.2474%** | **316** | **2132** |

**Reading.** 2,132 of the 2,448 same-kind excess rows (87.1%) were never duplicates:
they differ in `shares` or `percent`. The effect is largest exactly where the old gate
was most stuck — **2018 goes 300 excess (6.467%) to 2 (0.043%)**, which is the
measurement behind retiring the `…_max_year-2018-unreachable` floor: the year was
unreachable because the metric was counting one holder's many managed accounts, not
because the parser emitted 300 copies. 2023 (99 → 3), 2024 (131 → 7) and 2017 (110 → 6)
behave the same way. The worst year is now 2006 at 1.172%, still inside the 2.0%
ceiling, and the pooled rate 0.247% is inside the 1.0% ceiling with room.

**Honest limitation.** The gate is now SLACK: every gated metric passes at HEAD, so the
duplicate ceilings no longer drive the round. That is the operator's decision taken to
its conclusion, not an accident of it — the ceilings were driving work against rows
that should not be deleted. The 316 identical rows that remain are real over-emission
and are the honest residue; whether to tighten 0.01 toward that residue is a threshold
question for a future round and is NOT decided here.
