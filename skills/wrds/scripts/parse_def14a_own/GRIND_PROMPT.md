# Grind iteration — improve the DEF 14A ownership parser

You are one iteration of an unattended loop. Nothing you remember survives this
turn; the journal is the only memory. Read `GRIND_FLOORS`, `GRIND_SUBJECTS` and
`GRIND_NOTES` in this prompt before choosing what to work on, and do not
re-diagnose a floored key or an EXHAUSTED subject.

## The objective

Raise the scorer's gated metrics above the thresholds in
`skills/wrds/scripts/parse_def14a_own/thresholds.json`, by improving the PARSER.
The loop ends when this exits 0, and nothing else ends it:

```bash
bash /home/eh/projects/workflows/skills/wrds/scripts/parse_def14a_own/check.sh
```

**Exactly TEN metrics gate** — the keys under `minimums` (floors) plus the keys
under `maximums` (ceilings) in `thresholds.json`:

| gated metric | kind | threshold |
|---|---|---:|
| `regress_zero_row_recovered` | floor | **≥ 0.95** — THIS round's target |
| `regress_group_row_recovered` | floor | **≥ 0.95** — THIS round's target |
| `sample_dup_excess_identical_row_rate` | ceiling | ≤ 0.01 |
| `sample_dup_excess_identical_row_rate_max_year` | ceiling | ≤ 0.02 |
| `sample_yield_worst_year_margin` | floor | ≥ 0.0 — the per-year no-regression guard |
| `filing_yield_parsed_percent` | floor | 0.88 |
| `holder_recall_blockw` | floor | 0.75 |
| `holder_precision_blockw` | floor | 0.82 |
| `group_row_detection_rate` | floor | 0.80 |
| `iss_director_recall` | floor | 0.82 |

## THIS ROUND IS A REGRESSION ROUND (2026-09-29)

**The two `regress_*` floors are the only gates short, and recovering the filings
the last round lost is the only thing to work on.** Everything below this section
is a GUARD: those eight gates pass today, and a "fix" that breaks one of them still
exits 1. In particular **the identical-row duplicate ceilings are the guard that
stops you from getting the recovery by putting the duplicates back.**

### What regressed, measured

The full-archive re-run at `092b6fb9` (`def14a_full_run2.md`, 207,912 filings)
cut the identical-row duplicate rate 0.0190 → 0.0028 and lifted yield +0.32 pp,
and paid for it with two recall losses, both concentrated in the layouts the
duplicate rounds changed:

```
filings with >=1 row at 4b36a962 and ZERO rows at 092b6fb9   1,070   (0.51% of 207,912)
filings that LOST a D&O group row                            1,181   (1,618 group rows, 176 with a percent)
```

The zero-row losses cluster in **2002-2006 (58 / 96 / 96 / 145 / 85 filings) and
2018 (53)**.

### The ruler is new: a fixed panel DIFF

`gold/gold_regress.tsv` — **1,893 candidate filings**, built ONCE by
`gold/build_regress_set.py` as the diff of `panel_e4e78a95` (parser `4b36a962`)
against `panel` (parser `092b6fb9`). It is covered by `lock.sha256`: you may not
edit it, `run_baseline.sh` submits `round_filelist.tsv` (gold ∪ ISS ∪ sample ∪
regress, **22,856** filings) and asserts coverage before it submits, and
`score.py` exits **2** if the output does not cover the set.

| set | definition | denominator |
|---|---|---:|
| (a) ZERO-ROW, **gated** | old `n_rows` > 0 and new `n_rows` == 0, after the exclusions | **648** |
| (b) GROUP-ROW, **gated** | old group row, new none, and ≥ 1 lost group row carried a **parsed percent** | **83** |
| (b) share-only, diagnostic | the same minus the percent requirement | 1,054 |
| excluded, diagnostic | the old rows were demonstrably wrong (X1-X4 below) | 437 |

**SET CORRECTED 2026-09-30 by the operator; set (a) was 933 and is now 648.** Two
exclusion clauses were ADDED, X3 and X4, quoted from the loop's own floors — the
205 N-1A fund dollar-range tables and the 43 per-fund compensation tables had OLD
rows that were themselves wrong, so 0.95 over 933 was unreachable (ceiling 0.7342).
The **0.95 thresholds did not move**, `round_filelist.tsv` is byte-identical, and
the removed filings are still reported as a per-clause diagnostic. The two floors
`regress-zero-row-ceiling-0.761-dollar-range-tables` and
`regress-zero-row-ceiling-0.734-refined` are RESOLVED by that correction — see the
journal note `operator-regress-set-corrected` and GRIND_PLAN §12.

`regress_zero_row_recovered` = share of (a) that parses to ≥ 1 row again;
`regress_group_row_recovered` = share of (b) with a percent-carrying group row
again. Measured on the corrected set at the last scoring: **427 of 648 = 0.6590**
and **66 of 83 = 0.7952**, so the headroom is **221** filings and **17**. The
reachable residue the floors measured is `share_only_other` 197 + `has_percent` 32
= 229, and **390 of the ASCII-path residue went through the plain-text reader** —
that, not the fund tables, is where the work is.

The per-filing detail is `$DEF14A_WORK/regress_dev.tsv`, written by every scoring
run: one row per candidate filing with its set flags, its old row and group-row
counts, and what the round just emitted.

### Where to start — example accessions, read the documents first

These are from the run-2 report and from the setup; all three are in set (a):

| accession | year | what the old parser emitted, and what the document says |
|---|---|---|
| `0000950123-11-033365` | 2011 | Southwestern Energy. 13 rows then, **0 now**. The additive layout `Shares \| Options \| Restricted \| Exercisable \| Total \| Percent`: `Harold M. Korell 2,376,038 — 2,350 1,862,998 4,241,386 1.21 %` and the group row `… 9,920,963 (3) 2.82 %`. 2011's same-kind duplicate excess fell 0.0496 → 0.0077 in the same change: **the duplicate fix and this loss are one change seen from two sides.** |
| `0001206774-13-001019` | 2013 | GE. `As a group (27) 24,040,027 / 40,202,945` and `BlackRock 583,104,477`, **no percent anywhere** because the document says none ("No director or named executive owns more than 1%"). A share-count-only ownership table is still an ownership table. |
| `0001286964-20-000004` | 2020 | 2 rows then (`All Governors, Officers and Nominees as a Group 6,573,620 10.45`), 0 now. |
| `0000010048-03-000003` | 2003 | Barnwell. 13 rows → **2**: plain ASCII, name-and-address in one cell, percents stated; the new parser keeps only the 5%-holder table and drops tables 618 and 627. (Not in set (a) — it still emits 2 rows — but it is the same ASCII layout class as the 2002-2006 cluster.) |

### The exclusions, and why you must not chase them

437 candidate filings are EXCLUDED because the old rows were demonstrably wrong,
by four mechanical clauses — X1/X2 read in the documents during setup, X3/X4 added
2026-09-30 from the loop's own measured floors:

- **X1** — a `$` in an old `holder_name` (96 filings). The parser had read a
  DOLLAR column as the name: `Thomas R. $10,001-$50,000 $0` → shares 100000
  (`0000875626-06-000515`, an AGGREGATE DOLLAR RANGE OF EQUITY SECURITIES table),
  `President/CEO - Union National Bank 1996 $166,500 $38,295 [3]` → shares 13936
  (`0000891554-99-000468`, the SUMMARY COMPENSATION TABLE).
- **X2** — ≥ 3 old rows all carrying one identical `(shares, percent)` pair (58
  filings). `0001193125-12-089540` Pacholder 2012: 13 trustees each `100000`,
  from "Over $100,000". `0000930413-02-002213` Third Avenue 2002: 10 trustees each
  `0`, from "$0*".

- **X3** — no old row carries a percent AND ≥ half the filing's old `shares` values
  fall in the N-1A dollar-range endpoint set `{0,1,10000,50000,100000,500000,1000000}`
  (327 filings). The $1–$10,000 / $10,001–$50,000 / $50,001–$100,000 / over
  $100,000 bands read as share counts: `0000950137-04-004256`,
  `0001072613-08-000788` (DOLLAR RANGES OF SHARES OWNED BY TRUSTEES),
  `0001047469-06-007946`. X1/X2 miss them because the ranges DIFFER between
  trustees, so no three rows share one `(shares, percent)` pair and no name carries
  a `$`.
- **X4** — no percent anywhere AND ≥ 3 distinct old `table_index` values AND ≥ half
  the old rows carry a `holder_name` repeating 3+ times (43 filings). ALL 43 are one
  document, `0000051931-18-000890` (American Funds 2018, old `n_rows` 375), filed
  under 43 co-registrant CIKs and the ENTIRE 2018 residue: the fund-family
  compensation table attached once per fund, columns "Aggregate compensation from
  Fund … | Total compensation from all Funds | Dollar range of Fund shares owned",
  no share count and no percent. This is mechanism **M3**, which the round rejects.

`regress_excluded_emitting_rows_rate` is printed every round over the **422** of
those 437 that were zero-row candidates, and now ALSO per clause (x1 83, x2 58,
x3 325, x4 43 — overlapping denominators). **If any of them rises you have
re-accepted dollar-range and compensation tables**, which is the defect commit
`52f43c4f` removed, and the duplicate ceilings and `holder_precision_blockw` will
fail. `textMoneyBlock` rejects these correctly and **must not be weakened**. Do not
re-diagnose the dollar-range or per-fund-compensation families.

### Rules specific to THIS round

- **Write the failing test FIRST, and fix a LAYOUT CLASS.** Read 5-10 filings from
  `$DEF14A_WORK/regress_dev.tsv` with
  `parse_def14a_own_go/parse_def14a_own_go -debug /wrds/sec/archives/<relpath>`,
  transcribe a fixture from one into `parse_def14a_own_go/extract_test.go`, watch
  `go test ./...` go RED, then fix it. **No tuning on companies or filer agents.**
  A rule keyed to `Southwestern`, `GE`, `0001206774` or `Barnwell` is a threshold
  widened by another route; the set is fixed and locked, so a per-company rule can
  clear the gate while fixing nothing, and that is the one outcome this round must
  not produce.
- **NEVER re-introduce duplicates.** The identical-row gate
  (`sample_dup_excess_identical_row_rate` ≤ 0.01, `_max_year` ≤ 0.02) is the guard
  on exactly this round: the rows you are recovering were lost by rules that were
  put in to stop a row being emitted twice. Recover the row by making the ACCEPT
  rule right for the layout, not by reverting the reject rule. A round that ends
  green on recovery and red on duplicates has made the trade backwards.
- **A recovered row must be a REAL row.** `regress_zero_row_recovered` counts
  filings with ≥ 1 row, so one junk row would satisfy it per filing —
  `holder_precision_blockw` (≥ 0.82), `iss_director_recall` and the printed
  `regress_zero_row_new_rows` total are the checks, and the old row count over the
  same filings is printed beside it.
- **No gate may regress.** Report all ten every time, each with its denominator.
- **Wall time is REPORTED, never gated.** `run_baseline.sh` prints per-shard wall
  seconds and writes `$DEF14A_WORK/shard_wall.tsv`. The duplicate rounds already
  made the parser 1.30× slower shard-paired (22,907 s → 29,683 s over the full
  archive, worst on the late-era HTML shards). Note it in the journal when it
  moves; never optimise it, and never trade a recovery for it.
- The holdouts are ALL SPENT (see `thresholds.json` `holdouts_spent`). There is no
  holdout for this round: the regression set is itself a fixed, unseen-by-tuning
  ruler, and it is locked so that it stays that way.

## THE DUPLICATE-ROW ROUND (2026-09-29) — CLOSED, GUARD ONLY

**The text below is the previous round and is retained as a GUARD.** The two
identical-row ceilings pass today and they are what stops this round from buying
recovery with duplicates. Do not pick this round's subject from it.

### The ruler is new: a fixed full-archive sample

`gold/sample_full.tsv` — **8,250 filings, ~250 per FILING year 1994-2026**, seed
`20260929`, drawn from the full-archive manifests with every gold-linked filing
excluded. It exists because all five older gates read gold-linked filings only,
and the gold sets are vendor coverage of larger filers that never reaches
1994-1995 or 2025-2026. It is covered by `lock.sha256`: you may not edit it, and
`run_baseline.sh` submits `round_filelist.tsv` and asserts the coverage before it
submits (that list was gold ∪ ISS ∪ sample, 21,128 filings, when this round ran; it is
gold ∪ ISS ∪ sample ∪ regress, 22,856, now). `score.py` exits **2** if the
output does not cover the sample.

The per-year table is printed every round under `== (vi) FULL-ARCHIVE SAMPLE ==`
and written to `$DEF14A_WORK/sample_by_year.tsv`.

### What the duplicate metric is, exactly — REDEFINED 2026-09-29 by the operator

**A duplicate is an IDENTICAL ROW.** The gated key is

```
(accession, cik, table_kind, holder_name, share_class, shares, percent)
```

and the metric counts excess COPIES, `n-1` per group. `shares` and `percent` are
compared as the parser emitted them; `table_index` is deliberately NOT in the key,
so one row emitted out of two tables of the same kind still counts.

**The earlier definition — excess on `(accession, cik, holder_name, share_class)`
within one `table_kind` — is now a DIAGNOSTIC** (`sample_dup_excess_same_table_rate`
and `_max_year`, printed beside the gated pair every round). It counted
legitimately distinct rows as duplicates: one holder listed once per managed
account, each row with its OWN shares and percent, collapses onto that key.
AllianceBernstein 2018 was 264 of that year's 304 excess rows, and 620 of 4,352
across the sample. Two journal floors —
`one-record-holder-many-accounts-one-fund-class` and
`sample_dup_excess_same_table_rate_max_year-2018-unreachable` — recorded that the
old 2018 ceiling was unreachable without deleting true rows. **Both are SUPERSEDED**:
they were defects in the metric, not in the parser, and the new key admits no such
floor. Do not re-diagnose them, and do not work the diagnostic down.

**Cross-`table_kind` excess is legitimate and is NEVER gated.** A director who is
also a 5% holder is listed in the 5% holders table AND the management table and
both rows are real. Measured on the sample: 638 rows, 0.554%. **Do not suppress
it.** A fix that makes cross-kind excess fall is a fix that deleted a real
disclosure, and `holder_recall_blockw` / `iss_director_recall` will say so.

### Where the 9,953 same-kind excess rows come from — the mechanisms, named

Measured on the whole 2,903,798-row panel and then read with `-debug` on 12 of the
worst 2009 / 2018 / 2024 filings. **86.5% of the within-one-table excess carries
`share_class=""`.** That is the whole story: the class or series identity of a
value column is never carried into `share_class`, so rows that ARE distinct
collapse onto one exact key.

| mechanism | evidence | example accessions |
|---|---|---|
| **M1 — multi-class value columns, `share_class` left empty.** A multi-level header names the class over each `(shares, percent)` column pair; the parser pairs them into N rows and labels none, or labels only some (the `Total` and `combined voting power` columns get nothing). | 108,592 of 125,576 within-one-table excess rows have `share_class=""` | `0001193125-18-126922` A. H. Belo 2018 (4 class columns, 4 rows/holder, all `class=""`) · `0001258602-24-000028` Nelnet 2024 (`Class A` and `Class B` labelled, `Total` and voting-power NOT — 2 excess rows per holder) |
| **M2 — a row-level `Title of Class` / `Title of Series` column, mis-roled.** The column that states the class is given role `other` (so `share_class` stays empty) or, worse, role `name` (so `holder_name` becomes the class label). | Liberty Media emits 9 correct rows for John C. Malone, one per series, every one `class=""`; the Vanguard fund table emits `holder_name` = `Admiral Shares` | `0001104659-24-052085` Liberty Media 2024 (`Title of Series` → `other`) · `0001683863-24-008416` Vanguard 2024, excess 360 (`Title of Class` → `name`) |
| **M3 — non-ownership tables attached once per fund in a fund-family proxy.** Director *compensation* tables are read as ownership and dollar compensation lands in `shares`; the same trustees repeat across dozens of per-fund tables. This is known defect 4 at scale, and it is TRUE over-emission — the rows should not exist. | `roles=[name shares shares other other other other]` over a header reading `Aggregate compensation … from the fund` | `0000051931-09-000935` American Funds 2009, excess 622 · `0000051931-18-000890` 2018, excess 336 |
| **M4 — per-fund 5% record-holder tables.** One document, hundreds of funds, and Schwab / National Financial Services is a 5% record holder of most of them. The rows are REAL; the fund identity is simply never captured, so they collapse on the key. Fixing M1/M2 fixes this. | `0000719451-09-000023` emits 865 rows from one 748-row Fidelity table | `0000719451-09-000023` · `0000932471-09-000972` |
| **M5 — the ASCII text path glues the fund-class label onto the holder name.** | `Investor Shares: Charles Schwab & Co`, `Admiral Shares: Bank of New York State`, and truncations (`Earle S`, `Joseph T`) | `0000932471-09-000972` (`parser=text_table`) |

**The fix is to POPULATE `share_class`, not to suppress rows** (M1, M2, M4, M5),
and to REJECT the table (M3). A dedup-at-emit rule that drops the second row keeps
the duplicate rate down while throwing away a real per-series holding, and it is
the wrong fix even where no gate catches it.

### Rules specific to THIS round

- **Fix a LAYOUT CLASS, with the failing test first.** Transcribe a fixture from
  one of the accessions above into `parse_def14a_own_go/extract_test.go`, watch
  `go test ./...` go red, then fix it. **No tuning on company names or filer
  agents.** A rule keyed to `0000051931`, `Vanguard`, `Liberty Media` or
  `American Funds` is a threshold widened by another route.
- **Never suppress a legitimate cross-table listing.** Cross-`table_kind` excess
  is reported, not gated, precisely so that suppressing it buys you nothing.
- **Never collapse two rows that carry different values.** 59,969 of the
  within-one-table excess rows have DIFFERING `shares`. Those are distinct
  holdings whose class label is missing; merging them loses data and lowers no
  gate that matters. Since the 2026-09-29 redefinition they are not duplicates at
  all — a row with different `shares` or `percent` cannot enter the gated count,
  so populating `share_class` for them buys the gate nothing. Read the mechanism
  table below with that in mind: the rows the GATED metric now counts are the ones
  that repeat EVERY field, which is M3 (a non-ownership table attached once per
  fund, same trustees, same numbers) and the genuinely re-emitted row.
- **No gate may regress.** Report all eight every time with denominators. The
  per-year yield floor (`sample_yield_worst_year_margin`) exists so that
  duplicate cleanliness cannot be bought by dropping rows in one era: each year's
  parsed-percent yield on the sample may fall at most 0.005 below its value at
  HEAD.
- **Co-registrant multiplication is BY DESIGN and is not a defect.** 1,798
  accessions are filed under more than one CIK and the panel grain is
  `(cik, accession)`, so the same document's rows appear once per CIK. Measured:
  2018's same-kind excess is 18,165 counting per CIK against 4,718 counting each
  accession once. Do not "fix" it, and do not read the per-CIK number as
  per-document over-emission.

## THIS ROUND IS AN ISS DIRECTOR-RECALL ROUND (2026-09-29) — CLOSED, GUARD ONLY

**The text below is the previous round and is retained as a GUARD.**
`iss_director_recall` passes at 0.9135 against its permanent floor of 0.82 (the
0.90 in the old table below was that round's target and was reset when it
closed). Do not pick this round's subject from the ISS miss decomposition.

**`iss_director_recall` is the only gate short, and it is the only thing to work
on.** Baseline on ISS-dev, printed by `score.py` on unchanged parser output:

```
(a) director recall [gated]: 17007 / 19586 non-flagged ISS director rows = 86.83%
```

0.8683 against a 0.90 minimum — **0.0317**, about **620 director rows**. The
other four gates are guards: a "fix" that lifts ISS recall by emitting more
candidate rows will push `holder_precision_blockw` under 0.82, and `check.sh`
will still exit 1. **You cannot buy ISS recall with blockw precision.**

The ISS gold is `gold_iss.tsv.gz`: one row per (company, meeting, director) from
ISS/RiskMetrics Directors, 2002-2024, linked to the DEF 14A the meeting belongs
to. It is the only holder-level ruler that covers the modern era at all — blockw
is 1996-2001. Rows flagged by the 100x `num_of_shares` defect detector are
excluded from the denominator; 1,659 of 21,245 ISS-dev rows are flagged.

### Where the 2,579 missing rows are — start here, not from scratch

Miss decomposition printed by the scorer, denominator **19,586** non-flagged ISS
director rows in the 2,259 ISS-dev filings. `ok` (12,968) and
`name_found_shares_off` (3,649) are both **hits** — (a) is a name-only recall.
The three miss causes, largest first, plus the one non-miss cause worth reading:

| cause | rows | share of 19,586 | what it means | example accessions |
|---|---:|---:|---|---|
| `name_not_found` | **1,605** | 8.19% | the filing parsed a table, it is not short, and the director's name is not among the parsed rows | `0001193125-19-097303` Waters 2019 · `0001047469-07-007359` Estée Lauder 2007 · `0001047469-13-009333` Estée Lauder 2013 · `0000950152-05-002111` Lexmark 2005 · `0001144204-08-016722` LCA-Vision 2008 |
| `table_truncated` | **670** | 3.42% | rows exist but the filing's person-shaped row count is under half its ISS director count — a short table, not a name failure | `0001000229-17-000042` Core Labs 2017 (1 parsed row, 0 person rows, 8 ISS directors) · `0001193125-18-092158` Graham Holdings 2018 · `0001193125-23-077360` Graham Holdings 2023 (6 rows, 4 person, 9 directors) · `0000930413-02-001113` MONY 2002 · `0001206774-05-000564` Xerox 2005 (3 rows, 0 person, 9 directors) |
| `no_table` | **304** | 1.55% | the filing parsed to zero ownership rows | `0000950123-09-005010` Navigant 2009 · `0001193125-10-059627` Qwest 2010 · `0001042046-04-000021` American Financial 2004 · `0001308179-20-000107` Mondelez 2020 · `0001113169-02-000001` T. Rowe Price 2002 |
| `name_found_no_share_count_parsed` | 390 | 1.99% | **already a hit** for (a) — the name matched but no share count was parsed. Fixing it moves (b), which is DIAGNOSTIC. Do not spend the round here. | `0000950152-05-002111` Lexmark 2005 · `0000950134-08-004455` CARBO Ceramics 2008 · `0000950123-11-033213` Sealed Air 2011 · `0001308179-23-000452` Iron Mountain 2023 · `0000950123-11-028696` Forrester 2011 |

`name_not_found` + `table_truncated` + `no_table` = **2,579 (13.17%)**, exactly
`1 − 0.8683`. Closing roughly two thirds of the first two reaches 0.90.

The per-filing detail is `$DEF14A_WORK/miss_iss_dev.tsv`, written by every
scoring run: one row per ISS director with its cause, and with `n_parsed_rows`,
`n_person_rows` and `n_iss_directors` so a `table_truncated` filing can be read
without re-deriving anything.

Recall by era, so a fix is not traded between them:

| era | recall | denominator |
|---|---:|---:|
| 2002-2006 | 82.81% | 4,009 |
| 2007-2012 | 88.31% | 5,219 |
| 2013-2018 | 86.56% | 5,409 |
| 2019-2024 | 88.83% | 4,949 |

2002-2006 is the weakest and is where the ASCII / early-HTML families live.

### Rules specific to THIS round

- **Fix a LAYOUT CLASS, with the failing test first.** Read 5-10 filings for the
  cause with `-debug`, transcribe a fixture from one into
  `parse_def14a_own_go/extract_test.go`, watch `go test ./...` go red, then fix
  it. **No tuning on company names.** A rule keyed to `Waters`, `Graham
  Holdings`, `Estée Lauder` or any other issuer is a threshold widened by
  another route and will not survive the ISS holdout.
- **NEVER strip the 60-day option / deferred-unit add-on to make share counts
  match ISS.** The proxy's beneficial-ownership total INCLUDES options
  exercisable within 60 days and deferred units by rule; ISS's `num_of_shares`
  excludes them. The parser's total is the right one. Measured: the median
  `parsed / ISS` ratio is exactly 1.0000 in every era, and 2019-2024's share
  disagreement is 40.42% of matched rows parsing LARGER against 5.55% smaller —
  e.g. `0001558370-21-002589` (Hawaiian Electric 2021) adds a constant **+3,664**
  to every director, and `0001206774-22-000746` (Aflac 2022) has the same shape.
  That is a definitional gap in the gold, not a parser defect. It is exactly why
  `iss_share_agreement_1pct` / `_5pct` are DIAGNOSTIC — dropping the add-on would
  move a diagnostic up while making the parser wrong about the proxy's own
  disclosed total.
- **No gate may fall below its threshold.** Report all five every time, each with
  its denominator. An ISS-recall gain reported without the other four is not a
  result, and `check.sh` exits 1 if any one of them is short.
- `iss_individual_precision_proxy` is DIAGNOSTIC and is an UPPER bound (0.9726,
  with 37.92% of its numerator from the officer-allowance arm). Read it as a
  regression detector — if it falls while ISS recall rises, the fix is flooding
  the management table with non-people. Never optimise it.
- The ISS holdout (`holdout_iss.tsv`, 385 firms / 741 filings) was scored ONCE as
  the pre-round baseline and is off limits for the rest of the round.
  `score.py --iss-holdout` refuses while `GRIND_ITERATION` is set (exit 4).
- **Every round parses BOTH gold filelists.** `run_baseline.sh` defaults to
  `gold_filelist_all.tsv` and asserts coverage of `gold_filelist.tsv` and
  `gold_iss_filelist.tsv` before submitting; `score.py` exits 2 if the output does
  not cover the ISS gold filings. Do not work around either — a gated recall over
  a denominator the round chose for itself is not a measurement.
- **0.90 is this round's TARGET, not the permanent floor.** When the round ends
  the minimum is reset to **0.82**, the no-regression floor argued in
  `GRIND_PLAN.md` §8 item 1 and recorded in `thresholds.json` `_history`. That
  reset is not yours to make from inside an iteration — you may not edit
  `thresholds.json` at all.

## CARRIED OVER FROM THE PRECISION ROUND (2026-09-29) — GUARD, NOT TARGET

`holder_precision_blockw` passes at 0.8304 against 0.82. It is a guard this
round. The named false-positive families below are the ones that were being
worked; if a fix for ISS recall re-opens one of them, precision will fall through
0.82 and `check.sh` will exit 1.

### The residual false-positive families

From the journal note `residue-after-all-gates-pass` (subject `name_mismatch`),
measured with the harness in `/data/def14a_own/work/scratch/{fp,full,pkg}.py`,
which reproduces `score.py` precision to the digit. At that point **3,286
candidate rows were false positives** and **2,044 gold rows still missed on
name**. Named families, largest first:

| family | evidence | note |
|---|---|---|
| a trailing address or date glued to a real holder name | **550 candidate rows**, e.g. `Sanford C. Bernstein Co., Inc. 767 Fifth Avenue` | strip the tail, not the row — extra tokens only ever HELP `names_match`, so a careless strip costs recall |
| the `/N/` footnote form | `Wellington Management Company, LLP 3,786,250/1/` | `reFootnote` misses it, so the share count stays glued to the name |
| a share-class PREFIX column | `Common Stock William P. Conlin`, `Series B Convertible Preferred State Street Bank` | `reTrailClass` only strips a TRAILING class |
| forward-wrapping HOLDER names (not group labels) | `Common State Street Bank and`, `David M. Haig, Fred C. Weyand, Paul Mullin Ganley and` | `joinForwardLabel` exists but fires only on group rows |
| address lines that still survive `isAddressLine` | a city with no state (`San Francisco`), a state+ZIP alone (`California 94163`) | — |
| candidates at exactly 100% | **261** were pure FPs before the percent ceiling | the remainder are ESOP / preferred-class trustee rows and 100%-owned subsidiaries — real disclosures blockw's common-stock gold cannot match. **This is a ceiling, not a defect. Do not grind it.** |

### Rules specific to this round

- These families are **not this round's target.** Do not pick an iteration's
  subject from this table; pick it from the ISS miss decomposition above. The
  table is here so a regression in precision can be recognised for what it is.
- The blockw/factset holdout (seed **20260929**, 747 firms) was scored once as
  that round's pre-round baseline and stays off limits, exactly as before.

**Do NOT optimise the two FactSet metrics.** `group_pct_agreement_factset` and
`largest_block_agreement_factset` are **DIAGNOSTIC**: the scorer prints them with
their denominators under `== DIAGNOSTIC METRICS ==` every run and they can never
change the exit code. The FactSet gold is a proxy-window selection over all
FactSet stakes and mixes 13F / Form 4 positions (only 21 of 2,647 linked
firm-years carry a PXY marker), so work aimed at a 1 pp band against it is chasing
gold noise, not parser defects. Read them as a regression signal only; never pick
an iteration's subject because one of them is low, and never claim progress from
one moving.

## What you may edit, and what you may not

| may edit | must not touch |
|---|---|
| `parse_def14a_own_go/*.go` (the parser) | `scorer/score.py` |
| `parse_def14a_own_go/*_test.go` (its tests) | `thresholds.json` |
| `sge/*` when the run shape itself is wrong | `lock.sha256` |
| | anything under `/data/def14a_own/gold/` |

`check.sh` verifies `lock.sha256` over TEN files — the scorer, the thresholds, the
six gold files (including `gold_iss.tsv.gz` and `holdout_iss.tsv`), the fixed
sample `sample_full.tsv` and the fixed regression set `gold_regress.tsv` — before
it scores anything, and exits 3 if any of them moved. Editing
the ruler instead of the thing being measured is the failure this lock exists to
catch; it will be caught, and the iteration will have been wasted.

The HOLDOUT is off limits. `score.py --holdout` refuses while `GRIND_ITERATION`
is set, which it is for every iteration of this loop. Do not try to work around
it and do not read `/data/def14a_own/gold/holdout.tsv` for anything except the
`dev` filter the scorer already applies.

## The loop for one iteration

1. **Read the current regression detail.** This round that is
   `$DEF14A_WORK/regress_dev.tsv` — one row per candidate filing, with its set
   flags, the old row / group-row counts, what the round just emitted, and whether
   it counts as recovered. Group the NOT-yet-recovered filings of set (a) by
   something structural (filing year, `parser`, the old `table_kind`) and pick the
   largest group that is not floored and not exhausted.
   (`$DEF14A_WORK/miss_iss_dev.tsv` and `$DEF14A_WORK/miss_dev.tsv` are the ISS and
   blockw decompositions; they are the guard this round, not the target.)
2. **Look at actual filings.** Pick 5-10 filings from that group in
   `regress_dev.tsv` and read them:
   `parse_def14a_own_go/parse_def14a_own_go -debug /wrds/sec/archives/<relpath>`
   (locally: the same binary against a copy under `$DEF14A_WORK/samples/`).
   A fix written without reading the filings is a guess.
3. **Write the failing test first.** Add a fixture to
   `parse_def14a_own_go/extract_test.go` (or `main_test.go`) that reproduces the
   defect and fails. `go test ./...` must be red before it is green.
4. **Fix the parser.** `go test ./...` and `go vet ./...` must both pass.
5. **Re-run the grid pass and re-score.** `bash run_baseline.sh` submits the
   array, waits for it, and runs the scorer; it prints every metric with its
   denominator. Nothing you conclude counts unless that run printed it.
6. **Record.** One `progress` record if a metric moved; one `attempt` record
   otherwise; a `floor` with a `key` and a `why` when a cause is genuinely
   unfixable from the filing text (e.g. the document carries no percent at all).
   Commit the parser change with explicit paths — never `git add -A`, other
   sessions edit this repo concurrently.

## Rules that are not negotiable

- **Never widen a threshold, never loosen a test to make it pass.** If a metric
  cannot be reached, file a `floor` and say why.
- **Never report a number you did not see printed.** Quote the command and its
  exit code in the journal note.
- **The grid, not the login node.** Every parse runs through `qsub`. Ten slots
  per user in `all.q`, total; the array self-throttles.
- **Determinism.** Two runs of the parser over the same shard must produce
  byte-identical output. If a change breaks that, it is a bug in the change.
- One `progress` record per real movement, not per iteration.

## Journal

```bash
bash "$GRIND_SH" append --journal "$GRIND_JOURNAL" \
  '{"kind":"progress","subject":"group_row_missing","key":"ascii-3line-group","note":"group-row wrap assembled; group detection 0.71 -> 0.79 (run 2026-09-29T02:11, exit 0)"}'
bash "$GRIND_SH" append --journal "$GRIND_JOURNAL" \
  '{"kind":"floor","subject":"table_found_no_percent","key":"jnj-no-percent-disclosed","why":"the proxy states no 5% holder exists and the D&O table has share counts only; there is no percent in the document to parse"}'
```
