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

**Exactly FOUR metrics gate** — the keys under `minimums` in `thresholds.json`:

| gated metric | threshold |
|---|---:|
| `filing_yield_parsed_percent` | 0.88 |
| `holder_recall_blockw` | 0.75 |
| `holder_precision_blockw` | **0.82** (raised 2026-09-29, see below) |
| `group_row_detection_rate` | 0.80 |

## THIS ROUND IS A PRECISION ROUND (2026-09-29)

Three of the four gates already pass. **`holder_precision_blockw` is the only one
short, and it is the only thing to work on.** The other three are there as
guards: a "fix" that lifts precision by dropping rows will push recall under
0.75 or filing yield under 0.88, and `check.sh` will still exit 1. You cannot
buy precision with recall.

Why 0.82 and not 0.75: the seed-20260928 holdout scored precision **0.7085**
against dev **0.7843** — a **0.0759** gap, and the widest of the four (recall
0.7962 vs 0.8091, filing yield 0.8985 vs 0.9058, group-row 0.8968 vs 0.9026).
0.82 on dev is what it takes to land near 0.75 on firms nobody tuned on.

### The residual false-positive families — start here, not from scratch

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

- **A fix must not cost recall below 0.75, filing yield below 0.88 or group-row
  below 0.80.** Report all four every time; a precision gain reported without
  the other three is not a result.
- **No tuning on company names.** Fix a LAYOUT CLASS. A rule keyed to
  `Wellington`, `Sanford C. Bernstein` or any issuer name is a threshold widened
  by another route, and it will not survive the holdout.
- **The failing test comes first**, and it is a fixture transcribed from a real
  filing you read with `-debug`, exercising the layout class — not the one
  string that happens to be broken.
- The holdout was re-drawn for this round (seed **20260929**, 747 firms) and
  scored ONCE as the pre-round baseline. It is off limits for the rest of the
  round by exactly the same rule as before.

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

`check.sh` verifies `lock.sha256` over the scorer, the thresholds and the four
gold files before it scores anything, and exits 3 if any of them moved. Editing
the ruler instead of the thing being measured is the failure this lock exists to
catch; it will be caught, and the iteration will have been wasted.

The HOLDOUT is off limits. `score.py --holdout` refuses while `GRIND_ITERATION`
is set, which it is for every iteration of this loop. Do not try to work around
it and do not read `/data/def14a_own/gold/holdout.tsv` for anything except the
`dev` filter the scorer already applies.

## The loop for one iteration

1. **Read the current miss decomposition** — `$DEF14A_WORK/miss_dev.tsv`, written
   by the last scoring run, one row per gold-linked dev filing with its cause.
   Pick the LARGEST cause that is not floored and not exhausted.
2. **Look at actual filings.** Pick 5-10 filings with that cause from
   `miss_dev.tsv` and read them:
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
